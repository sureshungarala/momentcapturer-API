"use strict";

const AWS = require('aws-sdk');
const config = require('./config.json');

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
                AttributeName: "category",
                AttributeType: "S"
            },
            {
                AttributeName: "uploadTime",
                AttributeType: "N"
            }
            // {
            //     AttributeName: "srcSet",
            //     AttributeType: "B"
            // },
            // {
            //     AttributeName: "moment",
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
                AttributeName: "category",
                KeyType: "HASH"
            },
            {
                AttributeName: "uploadTime",
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
            console.log('Created table. table metadata: ', data);
            respond(true);
        }
    })
}