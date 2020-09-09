"use strict";

const AWS = require("aws-sdk");
const config = require("./config/config.json");
const columns = require("./config/columns.json");
const apis = require("./utils/apis");
const helpers = require("./utils/helpers");

/**
 * C =>compress image, S=>store in s3, R=> record in dynamoDB
 * biotc => best image of the category
 */

module.exports.csr = (event, context, callback) => {
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

  const dynamoRowItem = helpers.constructInitDynamoRowItem(params);

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
      await apis.compressAndStore(cAndsParams, config.HANDHELD);
      await apis.compressAndStore(cAndsParams, config.TABLET);
      await apis.compressAndStore(cAndsParams, config.LAPTOP);
      await apis.compressAndStore(cAndsParams, config.ORIGINAL);
      if (params.biotc) {
        const checkItemResp = await apis.checkIfBiotcExists(
          dynamoDB,
          params.category
        );
        if (checkItemResp[columns.updateTime.name]) {
          await apis.updateExistingBiotcImage(
            dynamoDB,
            checkItemResp[columns.updateTime.name],
            params.category
          );
          await apis.deleteBiotcImagesFromS3(s3, checkItemResp["objects"]);
        }
      }
      await apis.record(dynamoDB, dynamoRowItem);
      helpers.respond(true, callback);
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
        helpers.respond(false, callback);
      }
    } finally {
      console.info(`Finished running CSR.`);
    }
  }

  executeCSR();
};
