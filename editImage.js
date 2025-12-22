"use strict";

const AWS = require("aws-sdk");
const { updateImageIfExists } = require("./utils/apis");
const { respond, API_IDENTIFIERS } = require("./utils/helpers");
const config = require("./config/config.json");

module.exports.process = async (event) => {
  const { currentCategory, newCategory, description, updateTime } = JSON.parse(
    event.body
  );

  const dynamoDB = new AWS.DynamoDB({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION,
    apiVersion: "2012-08-10",
  });

  let success = false;
  let executionCount = 0;
  const maxRetries = Math.round(config.MAX_EXECUTION_COUNT);

  while (executionCount < maxRetries && !success) {
    executionCount++;
    try {
      await updateImageIfExists(
        dynamoDB,
        currentCategory,
        newCategory,
        description,
        updateTime
      );
      success = true;
    } catch (error) {
      console.error(
        `${API_IDENTIFIERS.EDIT_IMAGE.failure} with error ${error} with executionCount `,
        executionCount
      );
    }
  }

  return respond(API_IDENTIFIERS.EDIT_IMAGE.name, success);
};
