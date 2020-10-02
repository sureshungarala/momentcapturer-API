"use strict";

const AWS = require("aws-sdk");
const {
  getDynamoRowItem,
  softDeleteIfExists,
  deleteImagesFromS3,
} = require("./utils/apis");
const { respond, API_IDENTIFIERS } = require("./utils/helpers");
const columns = require("./config/columns.json");
const config = require("./config/config.json");

module.exports.process = (event, context, callback) => {
  const { category, updateTime } = JSON.parse(event.body);

  const dynamoDB = new AWS.DynamoDB({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION,
    apiVersion: "2012-08-10",
  });

  const s3 = new AWS.S3({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_S3_REGION,
    apiVersion: "2006-03-01",
  });

  let executionCount = 0;

  async function deleteImage() {
    executionCount++;
    try {
      const rowItem = await getDynamoRowItem(dynamoDB, category, updateTime);
      const rowItemUnmarshalled = AWS.DynamoDB.Converter.unmarshall(rowItem);
      const objects = [];
      const srcSet = rowItemUnmarshalled[columns.srcSet.name];
      for (let key in srcSet) {
        objects.push({
          Key: srcSet[key],
        });
      }
      objects.push({
        Key: rowItemUnmarshalled[columns.original.name],
      });
      await Promise.all([
        softDeleteIfExists(dynamoDB, category, updateTime),
        deleteImagesFromS3(s3, objects),
      ]);
      respond(API_IDENTIFIERS.DELETE_IMAGE.name, true, callback);
    } catch (error) {
      console.error(
        `${API_IDENTIFIERS.DELETE_IMAGE.failure} with error ${error} with executionCount `,
        executionCount
      );
      if (executionCount < Math.round(config.MAX_EXECUTION_COUNT)) {
        deleteImage();
      } else {
        respond(API_IDENTIFIERS.DELETE_IMAGE.name, false, callback);
      }
    }
  }

  deleteImage();
};
