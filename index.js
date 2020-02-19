"use strict";

const path = require('path');
const fs = require('fs');
const Q = require("q");
const AWS = require('aws-sdk');
const sharp = require('sharp');
const config = require('./config.json');
const columns = require('./columns.json');

/**
 * C =>compress image, S=>store in s3, R=> record in dynamoDB
 */

module.exports.csr = (event, context, callback) => {

    const params = JSON.parse(event.body),
        fileNameWithExt = params.imageName,
        resolution = params.resolution.split(':').map(Number),
        isBIOTC = params.biotc,   //best image of the category
        isPortrait = params.portrait,
        isPanorama = params.panorama,
        category = params.category,
        description = params.description;
    const fileName = fileNameWithExt.substr(0, fileNameWithExt.lastIndexOf('.')),
        decoded = Buffer.from(params.image.replace(/^data:image\/\w+;base64,/, ""), 'base64');

    let executionCount = 0;
    console.log('isBIOTC ', isBIOTC, ' typeof isPortrait is ', typeof isBIOTC);
    const Item = {
        [columns.category.name]: {
            [columns.category.type]: category
        },
        [columns.uploadTime.name]: {
            [columns.uploadTime.type]: ""
        },
        [columns.srcSet.name]: {
            [columns.srcSet.type]: {
                [config.HANDHELD_MAX_WIDTH]: {
                    [columns.srcSet.subType]: ""
                },
                [config.TABLET_MAX_WIDTH]: {
                    [columns.srcSet.subType]: ""
                },
                [config.LAPTOP_MAX_WIDTH]: {
                    [columns.srcSet.subType]: ""
                }
            }
        },
        [columns.biotc.name]: {
            [columns.biotc.type]: isBIOTC
        },
        [columns.panorama.name]: {
            [columns.panorama.type]: isPanorama
        },
        [columns.original.name]: {
            [columns.original.type]: ""
        },
        [columns.description.name]: {
            [columns.description.type]: description
        },
        [columns.resolution.name]: {
            [columns.resolution.type]: params.resolution
        },
        [columns.updateTime.name]: {
            [columns.updateTime.type]: ""
        },
        [columns.removed.name]: {
            [columns.removed.type]: false
        }
    };

    let s3 = new AWS.S3({
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        region: config.AWS_S3_REGION,
        apiVersion: '2006-03-01'
    }),
        dynamoDB = new AWS.DynamoDB({
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
            region: config.AWS_REGION,
            apiVersion: '2012-08-10'
        });
    //console.log(params);

    function compressAndStore(device) {
        let defer = Q.defer();
        sharp(decoded, {
            density: 515,
        }).jpeg({
            quality: 85,
            progressive: true,
            chromaSubsampling: '4:4:4',
            optimiseScans: true
        }).resize({   //default aspect ratio 3:2
            width: getResolution(device, config.WIDTH),
            height: getResolution(device, config.HEIGHT),
            fit: "contain",
            background: "rgb(255, 255, 255, 1)"    //alpha is transparency '0' is 100% transp...so, rgb doesn't matter when alpha is 0
        }).toBuffer((err, buffer, info) => {
            const Key = `${fileName}-${isBIOTC ? columns.biotc.name + '-' + device : device}.jpeg`;
            if (!err) {
                console.log(`Successfully compressed for ${device} with info `, info);
                s3.upload({
                    Key,
                    Body: buffer,
                    Bucket: config.AWS_S3_BUCKET_NAME
                }, (error, data) => {
                    if (error) {
                        console.log(`Failed to upload ${Key} to s3 with error `, error);
                        defer.reject(config.FAILURE);
                    } else {
                        if (device === config.HANDHELD || device === config.TABLET || device === config.LAPTOP) {
                            Item[columns.srcSet.name][columns.srcSet.type][device === config.HANDHELD ? config.HANDHELD_MAX_WIDTH : device === config.TABLET ? config.TABLET_MAX_WIDTH : config.LAPTOP_MAX_WIDTH][columns.srcSet.subType] = data.Location;
                        } else if (device === config.ORIGINAL) {
                            Item[columns.original.name][columns.original.type] = data.Location;
                        }
                        console.log(`Successfully uploaded ${Key} to s3 with metadata `, data);
                        defer.resolve(config.SUCCESS);
                    }
                });
            } else {
                console.log(`Failed to compress for ${device} with error `, err);
                defer.reject(config.FAILURE);
            }
        });
        return defer.promise;
    }

    function record() {
        let defer = Q.defer();
        Item[columns.uploadTime.name][columns.uploadTime.type] = '' + new Date().getTime();
        Item[columns.updateTime.name][columns.updateTime.type] = '' + new Date().getTime();
        console.log('Item ', Item);
        dynamoDB.putItem({
            TableName: config.AWS_DYNAMODB_TABLE,
            Item
        }, (err, data) => {
            if (err) {
                console.log(`Failed to record item to DynamoDB with error `, err);
                defer.reject(config.FAILURE);
            } else {
                console.log(`Successfully recorded item into DynamoDB with metadata `, data);
                defer.resolve(config.SUCCESS);
            }
        });
        return defer.promise;
    }

    function checkIfBiotcExists() {
        let defer = Q.defer();
        const getParams = {
            TableName: config.AWS_DYNAMODB_TABLE,
            ProjectionExpression: `${columns.updateTime.name},${columns.srcSet.name},${columns.original.name}`,
            KeyConditionExpression: `#category = :category`,
            FilterExpression: `#biotc = :biotc`,
            ExpressionAttributeNames: {
                "#category": columns.category.name,
                "#biotc": columns.biotc.name
            },
            ExpressionAttributeValues: {
                ":category": {
                    [columns.category.type]: category
                },
                ":biotc": {
                    [columns.biotc.type]: true
                }
            }
        };
        dynamoDB.query(getParams, (err, data) => {
            if (err) {
                console.log('Failed to getItem from DynamoDB with error', err);
                defer.reject(config.FAILURE);
            } else {
                console.log('BIOTC Item from dynamo ', data);
                const unmarshalled = data.Items.map(AWS.DynamoDB.Converter.unmarshall)[0];  // BIOTC image 
                console.log('unmarshalled ', unmarshalled);
                let item = {}, objects = [];
                if (unmarshalled && Object.keys(unmarshalled).length) {
                    for (let key in unmarshalled[columns.srcSet.name]) {
                        objects.push({
                            Key: unmarshalled[columns.srcSet.name][key]
                        })
                    }
                    objects.push({
                        Key: unmarshalled[columns.original.name]
                    });
                    item = {
                        objects,
                        [columns.updateTime.name]: unmarshalled[columns.updateTime.name]
                    }
                }
                console.log('Fetched BIOTC from DynamoDB.', item);
                defer.resolve(item);
            }
        });
        return defer.promise;
    }

    function updateExistingBiotcImage(lastUpdatedTime) {
        let defer = Q.defer();
        const updateParams = {
            TableName: config.AWS_DYNAMODB_TABLE,
            Key: {
                [columns.category.name]: {
                    [columns.category.type]: category
                },
                [columns.updateTime.name]: {
                    [columns.updateTime.type]: '' + lastUpdatedTime
                }
            },
            UpdateExpression: `SET #biotc = :biotc, #removed = :removed`,
            ExpressionAttributeNames: {
                "#biotc": columns.biotc.name,
                "#removed": columns.removed.name
            },
            ExpressionAttributeValues: {
                ":biotc": {
                    [columns.biotc.type]: false
                },
                ":removed": {
                    [columns.removed.type]: true
                }
            }
        };
        dynamoDB.updateItem(updateParams, (err, data) => {
            if (err) {
                console.log('Failed to update existing biotc to false with error ', err);
                defer.reject(config.FAILURE);
            } else {
                console.log(`Successully 'soft deleted' existing biotc `, data);
                defer.resolve(config.SUCCESS);
            }
        });
        return defer.promise;
    }

    function deleteBiotcImagesFromS3(Objects) {
        let defer = Q.defer();
        s3.deleteObjects({
            Bucket: config.AWS_S3_BUCKET_NAME,
            Delete: {
                Objects,
                Quiet: true
            }
        }, (err, data) => {
            if (err) {
                console.log('Failed to delete imgaes from S3 with error ', err);
                defer.reject(config.FAILURE);
            } else {
                console.log('Successfully deleted images ', Objects, ' from S3 with metadata ', data);
                defer.resolve(config.SUCCESS);
            }
        });
        return defer.promise;
    }

    function getResolution(device, axis) {
        if (axis === config.WIDTH) {
            if (isPortrait) {
                if (device === config.HANDHELD) {
                    return config.LANDSCAPE_HANDHELD_HEIGHT;
                } else if (device === config.TABLET) {
                    return config.LANDSCAPE_TABLET_HEIGHT;
                } else if (device === config.LAPTOP) {
                    return config.LANDSCAPE_LAPTOP_HEIGHT;
                } else {
                    return resolution[0];
                }
            } else if (isBIOTC || isPanorama) {
                if (device === config.HANDHELD) {
                    return config.BITOC_HANDHELD_WIDTH;
                } else if (device === config.TABLET) {
                    return config.BITOC_TABLET_WIDTH;
                } else if (device === config.LAPTOP) {
                    return config.BITOC_LAPTOP_WIDTH;
                } else {
                    return resolution[0];
                }
            } else {
                if (device === config.HANDHELD) {
                    return config.LANDSCAPE_HANDHELD_WIDTH;
                } else if (device === config.TABLET) {
                    return config.LANDSCAPE_TABLET_WIDTH;
                } else if (device === config.LAPTOP) {
                    return config.LANDSCAPE_LAPTOP_WIDTH;
                } else {
                    return resolution[0];
                }
            }
        } else {
            if (isPortrait) {
                if (device === config.HANDHELD) {
                    return config.LANDSCAPE_HANDHELD_WIDTH;
                } else if (device === config.TABLET) {
                    return config.LANDSCAPE_TABLET_WIDTH;
                } else if (device === config.LAPTOP) {
                    return config.LANDSCAPE_LAPTOP_WIDTH;
                } else {
                    return resolution[1];
                }
            } else if (isBIOTC || isPanorama) {
                if (device === config.HANDHELD) {
                    return Math.round(Number(config.BITOC_HANDHELD_WIDTH) * (resolution[1] / resolution[0]));
                } else if (device === config.TABLET) {
                    return Math.round(Number(config.BITOC_TABLET_WIDTH) * (resolution[1] / resolution[0]));
                } else if (device === config.LAPTOP) {
                    return Math.round(Number(config.BITOC_LAPTOP_WIDTH) * (resolution[1] / resolution[0]));
                } else {
                    return resolution[1];
                }
            } else {
                if (device === config.HANDHELD) {
                    return config.LANDSCAPE_HANDHELD_HEIGHT;
                } else if (device === config.TABLET) {
                    return config.LANDSCAPE_TABLET_HEIGHT;
                } else if (device === config.LAPTOP) {
                    return config.LANDSCAPE_LAPTOP_HEIGHT;
                } else {
                    return resolution[1];
                }
            }
        }
    }

    function respond(success) {
        const response = {
            statusCode: success ? 200 : 500,
            "headers": {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                message: success ? "Executed CSR :)" : "Failed to execute CSR :(",
            }, null, 2)
        };
        callback(null, response);
    }

    async function executeCSR() {
        executionCount++;
        try {
            await compressAndStore(config.HANDHELD);
            await compressAndStore(config.TABLET);
            await compressAndStore(config.LAPTOP);
            await compressAndStore(config.ORIGINAL);
            if (isBIOTC) {
                const checkItemResp = await checkIfBiotcExists();
                if (checkItemResp[columns.updateTime.name]) {
                    await updateExistingBiotcImage(checkItemResp[columns.updateTime.name]);
                    await deleteBiotcImagesFromS3(checkItemResp['objects']);
                }
            }
            await record();
            respond(true);
        } catch (err) {
            console.log('CSR failed with error ', err, executionCount);
            if (executionCount < Math.round(config.MAX_EXECUTION_COUNT)) {
                executeCSR();
            } else {
                respond(false);
            }
        } finally {
            console.log(`Executed CSR.`);
        }
    }

    executeCSR();
}