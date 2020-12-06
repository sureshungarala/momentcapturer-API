"use strict";

const AWS = require("aws-sdk");
const config = require("./config/config.json");
const columns = require("./config/columns.json");
const { respond, API_IDENTIFIERS } = require("./utils/helpers");

module.exports.createTable = (event, context, callback) => {
  let dynamoDB = new AWS.DynamoDB({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION,
    apiVersion: "2012-08-10",
  });

  const tableParams = {
    TableName: config.AWS_DYNAMODB_TABLE,
    AttributeDefinitions: [
      {
        AttributeName: columns.category.name,
        AttributeType: "S",
      },
      {
        AttributeName: columns.updateTime.name,
        AttributeType: "N",
      },
    ],
    KeySchema: [
      {
        AttributeName: columns.category.name,
        KeyType: "HASH",
      },
      {
        AttributeName: columns.updateTime.name,
        KeyType: "RANGE",
      },
    ],
    BillingMode: "PROVISIONED",
    ProvisionedThroughput: {
      ReadCapacityUnits: 10,
      WriteCapacityUnits: 10,
    },
    Tags: [
      {
        Key: "Owner",
        Value: "Suresh Ungarala:iamuvvsuresh:at:gmail.com",
      },
      {
        Key: "Website",
        Value: "momentcapturer.com",
      },
    ],
  };

  dynamoDB.createTable(tableParams, (error, data) => {
    if (error) {
      console.error("Failed to create table with error: ", error);
      respond(API_IDENTIFIERS.CREATE_TABLE.name, false, callback);
    } else {
      console.info("Table created with metadata: ", data);
      respond(API_IDENTIFIERS.CREATE_TABLE.name, true, callback);
    }
  });
};

module.exports.getData = (event, context, callback) => {
  const params = event.queryStringParameters,
    category = params.category;

  let dynamoDB = new AWS.DynamoDB({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION,
    apiVersion: "2012-08-10",
  });

  dynamoDB.query(
    {
      TableName: config.AWS_DYNAMODB_TABLE,
      ProjectionExpression: `${columns.updateTime.name},${columns.srcSet.name},${columns.original.name},${columns.biotc.name},${columns.panorama.name},${columns.portrait.name},${columns.description.name},${columns.resolution.name}`,
      KeyConditionExpression: `#category = :category`,
      FilterExpression: `#removed = :removed`,
      ExpressionAttributeNames: {
        "#category": columns.category.name,
        "#removed": columns.removed.name,
      },
      ExpressionAttributeValues: {
        ":category": {
          [columns.category.type]: category,
        },
        ":removed": {
          [columns.removed.type]: false,
        },
      },
      ScanIndexForward: false,
    },
    (error, data) => {
      if (error) {
        console.error("Failed to query DynamoDB with error: ", error);
        respond(API_IDENTIFIERS.FETCH_IMAGES.name, false, callback);
      } else {
        const unmarshalled = data.Items.map(AWS.DynamoDB.Converter.unmarshall);
        respond(
          API_IDENTIFIERS.FETCH_IMAGES.name,
          true,
          callback,
          unmarshalled,
          true
        );
      }
    }
  );
};
