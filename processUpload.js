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
 * Processes an image that was uploaded directly to S3 via pre-signed URL.
 * Downloads the image from S3 (as pure binary Buffer), compresses for different
 * viewports using Sharp, and stores the processed images.
 */
module.exports.process = async (event) => {
  const startTime = new Date();
  console.info("startTime ", startTime.toISOString());

  const { objectKey, ...params } = JSON.parse(event.body);

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

  // Download image from S3 - this returns a pure binary Buffer, no base64!
  let imageBuffer;
  try {
    const s3Object = await s3
      .getObject({
        Bucket: config.AWS_S3_BUCKET_NAME,
        Key: objectKey,
      })
      .promise();
    imageBuffer = s3Object.Body; // Already a Buffer
    console.info(
      `Downloaded ${objectKey} from S3 (${imageBuffer.length} bytes)`
    );
  } catch (error) {
    console.error("Failed to download from S3:", error);
    return respond(API_IDENTIFIERS.PROCESS_UPLOAD.name, false);
  }

  const fileName = params.imageName.substr(
    0,
    params.imageName.lastIndexOf(".")
  );
  const dynamoRowItem = constructInitDynamoRowItem(params);

  let success = false;
  let executionCount = 0;
  const maxRetries = Math.round(config.MAX_EXECUTION_COUNT);

  while (executionCount < maxRetries && !success) {
    executionCount++;
    try {
      const cAndsParams = {
        s3,
        imageBuffer,
        dynamoRowItem,
        fileName,
        params,
        currentTimeInMs: new Date().getTime(),
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
      success = true;
    } catch (error) {
      console.error(
        "Processing failed with error: ",
        error,
        " :ExecutionCount: ",
        executionCount
      );
    }
  }

  // Clean up temporary file from S3
  if (success) {
    try {
      await s3
        .deleteObject({
          Bucket: config.AWS_S3_BUCKET_NAME,
          Key: objectKey,
        })
        .promise();
      console.info(`Deleted temp file ${objectKey}`);
    } catch (cleanupError) {
      // Non-critical - log but don't fail
      console.warn("Failed to delete temp file:", cleanupError);
    }
  }

  const endTime = new Date();
  console.info(
    `Finished running processUpload in ${(
      (endTime.getTime() - startTime.getTime()) /
      1000
    ).toFixed(2)}secs, at ${endTime.toISOString()}`
  );

  return respond(API_IDENTIFIERS.PROCESS_UPLOAD.name, success);
};
