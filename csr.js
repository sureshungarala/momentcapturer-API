"use strict";

const AWS = require("aws-sdk");
const config = require("./config/config.json");
const columns = require("./config/columns.json");
const {
  compressAndStore,
  checkIfBiotcExists,
  softDeleteExistingBiotcImage,
  deleteImagesFromS3,
  record,
} = require("./utils/apis");
const {
  constructInitDynamoRowItem,
  respond,
  API_IDENTIFIERS,
} = require("./utils/helpers");

/**
 * C =>compress image, S=>store in s3, R=> record in dynamoDB
 * biotc => best image of the category
 */

module.exports.process = (event, context, callback) => {
  const startTime = new Date();
  console.info("startTime ", startTime.toISOString());
  const { image, ...params } = JSON.parse(event.body);

  const s3 = new AWS.S3({
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      region: config.AWS_S3_REGION,
      apiVersion: "2006-03-01",
    }),
    dynamoDB = new AWS.DynamoDB({
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      region: config.AWS_REGION,
      apiVersion: "2012-08-10",
    });

  const fileName = params.imageName.substr(
    0,
    params.imageName.lastIndexOf(".")
  );
  const imageBuffer = Buffer.from(
    image.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );

  const dynamoRowItem = constructInitDynamoRowItem(params);

  let executionCount = 0; // failure threshold -> execution count

  async function executeCSR() {
    executionCount++;
    try {
      const cAndsParams = {
        s3,
        imageBuffer,
        dynamoRowItem,
        fileName,
        params,
      };
      await Promise.all([
        compressAndStore(cAndsParams, config.HANDHELD),
        compressAndStore(cAndsParams, config.TABLET),
        compressAndStore(cAndsParams, config.LAPTOP),
        compressAndStore(cAndsParams, config.ORIGINAL),
      ]);
      if (params.biotc) {
        const checkItemResp = await checkIfBiotcExists(
          dynamoDB,
          params.category
        );
        if (checkItemResp[columns.updateTime.name]) {
          await Promise.all([
            softDeleteExistingBiotcImage(
              dynamoDB,
              checkItemResp[columns.updateTime.name],
              params.category
            ),
            deleteImagesFromS3(s3, checkItemResp["objects"]),
          ]);
        }
      }
      await record(dynamoDB, dynamoRowItem);
      respond(API_IDENTIFIERS.CSR.name, true, callback);
    } catch (error) {
      console.error(
        "CSR failed with error: ",
        error,
        " :ExecutionCount: ",
        executionCount
      );
      if (executionCount < Math.round(config.MAX_EXECUTION_COUNT)) {
        executeCSR();
      } else {
        respond(API_IDENTIFIERS.CSR.name, false, callback);
      }
    } finally {
      const endTime = new Date();
      console.info(
        `Finished running CSR. in 
        ${((endTime.getTime() - startTime.getTime()) / 1000).toFixed(
          2
        )}secs, at ${endTime.toISOString()}`
      );
    }
  }

  executeCSR();
};
