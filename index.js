"use strict";

const AWS = require('aws-sdk');
const sharp = require('sharp');

/**
 * C =>compress, S=>store in s3, R=> record in dynamoDB
 */

module.exports.csr = (event, context, callback) => {

    callback(null, {
        "statusCode": 200,
        "headers": {
            "Access-Control-Allow-Origin": "*"
        },
        "body": JSON.stringify({
            message: "Executed CSR.",
            input: event
        }, null, 2)
    });
}