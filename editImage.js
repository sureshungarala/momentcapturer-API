"use strict";

const AWS = require("aws-sdk");
const config = require("./config/config.json");

module.exports.process = (event, context, callback) => {
  const { image, ...params } = JSON.parse(event.body);

  const s3 = new AWS.S3({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_S3_REGION,
    apiVersion: "2006-03-01",
  });
  const dynamoDB = new AWS.DynamoDB({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION,
    apiVersion: "2012-08-10",
  });
};
