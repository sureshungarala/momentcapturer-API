"use strict";

const AWS = require('aws-sdk');
const config = require('./config.json');
const columns = require('./columns.json');

module.exports.createTable = (event, context, callback) => {

    let dynamoDB = new AWS.DynamoDB({
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        region: config.AWS_REGION,
        apiVersion: '2012-08-10'
    });

    const tableParams = {
        TableName: config.AWS_DYNAMODB_TABLE,
        AttributeDefinitions: [
            {
                AttributeName: columns.category.name,
                AttributeType: "S"
            },
            {
                AttributeName: columns.updateTime.name,
                AttributeType: "N"
            }
            // {
            //     AttributeName: "srcSet",
            //     AttributeType: "B"
            // },
            // {
            //     AttributeName: "original",
            //     AttributeType: "S"
            // },
            // {
            //     AttributeName: "description",
            //     AttributeType: "S"
            // },
            // {
            //     AttributeName: "updateTime",
            //     AttributeType: "N"
            // },
            // {
            //     AttributeName: "removed",
            //     AttributeType: "N"
            // }
        ],
        KeySchema: [
            {
                AttributeName: columns.category.name,
                KeyType: "HASH"
            },
            {
                AttributeName: columns.updateTime.name,
                KeyType: 'RANGE'
            }
        ],
        BillingMode: 'PROVISIONED',
        ProvisionedThroughput: {
            ReadCapacityUnits: 10,
            WriteCapacityUnits: 10
        },
        Tags: [
            {
                Key: 'Owner',
                Value: 'Suresh Ungarala:iamuvvsuresh:at:gmail.com'
            },
            {
                Key: 'Website',
                Value: 'momentcapturer.com'
            }
        ]
    };

    function respond(success) {
        const response = {
            statusCode: success ? 200 : 500,
            "headers": {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                message: success ? "Created DynamoDB table :)" : "Failed to create DynamoDB table :(",
            }, null, 2)
        };
        callback(null, response);
    }

    dynamoDB.createTable(tableParams, (err, data) => {
        if (err) {
            console.log('Unable to create table. Error: ', err);
            respond(false);
        } else {
            console.log('Created table. table metadata: ');
            respond(true);
        }
    })
};

module.exports.getData = (event, context, callback) => {
    console.log('event ', event);
    const params = event.queryStringParameters,
        category = params.category;

    console.log('params ', params);

    let dynamoDB = new AWS.DynamoDB({
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        region: config.AWS_REGION,
        apiVersion: '2012-08-10'
    });

    function respond(success, data) {
        const response = {
            statusCode: success ? 200 : 500,
            "headers": {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                message: success ? "Successfully fetched data." : "Fetched to fetch data :(",
                images: data,
            }, null, 2)
        };
        callback(null, response);
    }

    dynamoDB.query({
        TableName: config.AWS_DYNAMODB_TABLE,
        ProjectionExpression: `${columns.updateTime.name},${columns.srcSet.name},${columns.original.name},${columns.biotc.name},${columns.panorama.name},${columns.description.name}`,
        KeyConditionExpression: `#category = :category`,
        FilterExpression: `#removed = :removed`,
        ExpressionAttributeNames: {
            "#category": columns.category.name,
            "#removed": columns.removed.name
        },
        ExpressionAttributeValues: {
            ":category": {
                [columns.category.type]: category
            },
            ":removed": {
                [columns.removed.type]: false
            }
        },
        ScanIndexForward: false
    }, (err, data) => {
        if (err) {
            console.log('Failed to query DynamoDB.', err);
            respond(false);
        } else {
            const unmarshalled = data.Items.map(AWS.DynamoDB.Converter.unmarshall);
            console.log('Fetched data from DynamoDB.', unmarshalled);
            respond(true, unmarshalled);
        }
    });
};