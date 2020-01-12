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
        category = params.category,
        description = params.description;
    const fileName = fileNameWithExt.substr(0, fileNameWithExt.lastIndexOf('.')),
        decoded = Buffer.from(params.image.replace(/^data:image\/\w+;base64,/, ""), 'base64');

    let executionCount = 1;

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
                }
            }
        },
        [columns.moment.name]: {
            [columns.moment.type]: ""
        },
        [columns.description.name]: {
            [columns.description.type]: description
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
        region: config.AWS_REGION,
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
        }).resize({   //aspect ratio 4:3
            width: device === config.HANDHELD ? 500 : device === config.TABLET ? 900 : resolution[0],
            height: device === config.HANDHELD ? 375 : device === config.TABLET ? 675 : resolution[1],
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 0 }    //alpha is transparency '0' is 100% transp...so, rgb doesn't matter when alpha is 0
        }).toBuffer((err, buffer, info) => {
            const Key = `${fileName}-${device}.jpeg`;
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
                        if (device === config.HANDHELD || device === config.TABLET) {
                            Item[columns.srcSet.name][columns.srcSet.type][device === config.HANDHELD ? config.HANDHELD_MAX_WIDTH : config.TABLET_MAX_WIDTH][columns.srcSet.subType] = data.Location;
                        } else if (device === config.ORIGINAL) {
                            Item[columns.moment.name][columns.moment.type] = data.Location;
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
            } else {
                console.log(`Successfully recorded item into DynamoDB with metadata `, data);
            }
        });
        return defer.promise;
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
        let processed = false;
        try {
            const handheldResp = await compressAndStore(config.HANDHELD);
            if (handheldResp === config.SUCCESS) {
                const tabletResp = await compressAndStore(config.TABLET);
                if (tabletResp === config.SUCCESS) {
                    const originalResp = await compressAndStore(config.ORIGINAL);
                    originalResp === config.SUCCESS && await record();
                }
            }
            processed = true;
        } catch (err) {
            processed = false;
            console.log('CSR failed with error ', err);
        } finally {
            console.log(`Executed CSR.`);
            respond(processed);
        }
    }

    executeCSR();
}