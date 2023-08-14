'use strict';

const AWS = require('aws-sdk');
const { updateImageIfExists } = require('./utils/apis');
const { respond, API_IDENTIFIERS } = require('./utils/helpers');
const config = require('./config/config.json');

module.exports.process = (event, _context, callback) => {
  const { currentCategory, newCategory, description, updateTime } = JSON.parse(
    event.body
  );

  const dynamoDB = new AWS.DynamoDB({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_REGION,
    apiVersion: '2012-08-10',
  });

  let executionCount = 0;

  async function updateImageMetadata() {
    executionCount++;
    try {
      await updateImageIfExists(
        dynamoDB,
        currentCategory,
        newCategory,
        description,
        updateTime
      );
      respond(API_IDENTIFIERS.EDIT_IMAGE.name, true, callback);
    } catch (error) {
      console.error(
        `${API_IDENTIFIERS.EDIT_IMAGE.failure} with error ${error} with executionCount `,
        executionCount
      );
      if (executionCount < Math.round(config.MAX_EXECUTION_COUNT)) {
        updateImageMetadata();
      } else {
        respond(API_IDENTIFIERS.EDIT_IMAGE.name, false, callback);
      }
    }
  }

  updateImageMetadata();
};
