"use strict";

const AWS = require("aws-sdk");
const config = require("./config/config.json");
const { respond, API_IDENTIFIERS } = require("./utils/helpers");

/**
 * Generates a pre-signed S3 URL for direct client upload.
 * This bypasses Lambda's 6MB payload limit by having clients upload directly to S3.
 */
module.exports.process = async (event) => {
  const { fileName, contentType } = JSON.parse(event.body);

  const s3 = new AWS.S3({
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    region: config.AWS_S3_REGION,
    signatureVersion: "v4",
  });

  // Use temp-uploads prefix for temporary uploads that will be processed and deleted
  const objectKey = `temp-uploads/${Date.now()}-${fileName}`;

  try {
    const uploadUrl = await s3.getSignedUrlPromise("putObject", {
      Bucket: config.AWS_S3_BUCKET_NAME,
      Key: objectKey,
      Expires: 300, // URL valid for 5 minutes
      ContentType: contentType,
    });

    console.info(`Generated pre-signed URL for ${objectKey}`);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      },
      body: JSON.stringify({ uploadUrl, objectKey }),
    };
  } catch (error) {
    console.error("Failed to generate upload URL:", error);
    return respond(API_IDENTIFIERS.GET_UPLOAD_URL.name, false);
  }
};
