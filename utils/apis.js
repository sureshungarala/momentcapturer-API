const AWS = require("aws-sdk");
const sharp = require("sharp");
const columns = require("../config/columns.json");
const config = require("../config/config.json");
const { getResolution, extractFileNameFromUrl } = require("./helpers");

const checkIfBiotcExists = async (dynamoDB, category) => {
  const getParams = {
    TableName: config.AWS_DYNAMODB_TABLE,
    ProjectionExpression: `${columns.updateTime.name},${columns.srcSet.name},${columns.original.name}`,
    KeyConditionExpression: `#category = :category`,
    FilterExpression: `#biotc = :biotc`,
    ExpressionAttributeNames: {
      "#category": columns.category.name,
      "#biotc": columns.biotc.name,
    },
    ExpressionAttributeValues: {
      ":category": {
        [columns.category.type]: category,
      },
      ":biotc": {
        [columns.biotc.type]: true,
      },
    },
  };

  try {
    const data = await dynamoDB.query(getParams).promise();
    const unmarshalled = data.Items.map(AWS.DynamoDB.Converter.unmarshall)[0];
    let item = {},
      objects = [];
    if (unmarshalled && Object.keys(unmarshalled).length) {
      const srcSet = unmarshalled[columns.srcSet.name];
      for (let key in srcSet) {
        objects.push({
          Key: extractFileNameFromUrl(srcSet[key]),
        });
      }
      objects.push({
        Key: extractFileNameFromUrl(unmarshalled[columns.original.name]),
      });
      item = {
        objects,
        [columns.updateTime.name]: unmarshalled[columns.updateTime.name],
      };
    }
    console.info("Fetched BIOTC from DynamoDB.", item);
    return item;
  } catch (err) {
    console.error("Failed to getItem from DynamoDB with error: ", err);
    throw config.FAILURE;
  }
};

const softDeleteExistingBiotcImage = async (
  dynamoDB,
  lastUpdatedTime,
  category
) => {
  const updateParams = {
    TableName: config.AWS_DYNAMODB_TABLE,
    Key: {
      [columns.category.name]: {
        [columns.category.type]: category,
      },
      [columns.updateTime.name]: {
        [columns.updateTime.type]: "" + lastUpdatedTime,
      },
    },
    UpdateExpression: `SET #biotc = :biotc, #removed = :removed`,
    ExpressionAttributeNames: {
      "#biotc": columns.biotc.name,
      "#removed": columns.removed.name,
    },
    ExpressionAttributeValues: {
      ":biotc": {
        [columns.biotc.type]: false,
      },
      ":removed": {
        [columns.removed.type]: true,
      },
    },
  };

  try {
    const data = await dynamoDB.updateItem(updateParams).promise();
    console.info(`Successully 'soft deleted' existing biotc `, data);
    return config.SUCCESS;
  } catch (error) {
    console.error(
      "Failed to update existing biotc to false with error ",
      error
    );
    throw config.FAILURE;
  }
};

const deleteImagesFromS3 = async (s3, Objects) => {
  try {
    const data = await s3
      .deleteObjects({
        Bucket: config.AWS_S3_BUCKET_NAME,
        Delete: {
          Objects,
          Quiet: true,
        },
      })
      .promise();
    console.info(
      "Successfully deleted images: ",
      Objects,
      " :from S3 with metadata: ",
      data
    );
    return config.SUCCESS;
  } catch (error) {
    console.error("Failed to delete imgaes from S3 with error ", error);
    throw config.FAILURE;
  }
};

const record = async (dynamoDB, dynamoRowItem, updateTime) => {
  dynamoRowItem[columns.uploadTime.name][columns.uploadTime.type] =
    "" + new Date().getTime();
  dynamoRowItem[columns.updateTime.name][columns.updateTime.type] =
    "" + (updateTime ? updateTime : new Date().getTime());

  try {
    const data = await dynamoDB
      .putItem({
        TableName: config.AWS_DYNAMODB_TABLE,
        Item: dynamoRowItem,
      })
      .promise();
    console.info(
      `Successfully recorded item into DynamoDB with metadata `,
      data
    );
    return config.SUCCESS;
  } catch (error) {
    console.error(`Failed to record item to DynamoDB with error `, error);
    throw config.FAILURE;
  }
};

const compressAndStore = async (
  { s3, imageBuffer, dynamoRowItem, fileName, params, currentTimeInMs },
  device
) => {
  try {
    const buffer = await sharp(imageBuffer, {
      density: 515,
    })
      .jpeg({
        quality: 80,
        progressive: true,
        optimiseScans: true,
      })
      .resize({
        width: getResolution(device, config.WIDTH, params),
        height: getResolution(device, config.HEIGHT, params),
        fit: "contain",
        background: "rgb(255, 255, 255, 1)",
      })
      .toBuffer();

    const Key = `${fileName}-${
      params.biotc ? columns.biotc.name + "-" + device : device
    }-${currentTimeInMs}.jpeg`;

    console.info(`Successfully compressed for ${device}`);

    const data = await s3
      .upload({
        Key,
        Body: buffer,
        Bucket: config.AWS_S3_BUCKET_NAME,
        CacheControl: "public, max-age=31536000",
        ContentType: "image/jpeg",
      })
      .promise();

    if (
      device === config.HANDHELD ||
      device === config.TABLET ||
      device === config.LAPTOP
    ) {
      dynamoRowItem[columns.srcSet.name][columns.srcSet.type][
        device === config.HANDHELD
          ? config.HANDHELD_MAX_WIDTH
          : device === config.TABLET
          ? config.TABLET_MAX_WIDTH
          : config.LAPTOP_MAX_WIDTH
      ][columns.srcSet.subType] = data.Location;
    } else if (device === config.ORIGINAL) {
      dynamoRowItem[columns.original.name][columns.original.type] =
        data.Location;
    }
    console.info(`Successfully uploaded ${Key} to s3 with metadata `, data);
    return config.SUCCESS;
  } catch (err) {
    console.error(`Failed to compress/upload for ${device} with error `, err);
    throw config.FAILURE;
  }
};

const getDynamoRowItem = async (dynamoDB, category, updateTime) => {
  const params = {
    Key: {
      [columns.category.name]: {
        [columns.category.type]: category,
      },
      [columns.updateTime.name]: {
        [columns.updateTime.type]: "" + updateTime,
      },
    },
    TableName: config.AWS_DYNAMODB_TABLE,
  };

  try {
    const data = await dynamoDB.getItem(params).promise();
    console.info(`Successfully fetched item from DynamoDB `, data);
    return data.Item;
  } catch (err) {
    console.error(
      `Failed to get matching item from DynamoDB with error `,
      err
    );
    throw config.FAILURE;
  }
};

const softDeleteIfExists = async (dynamoDB, currentCategory, updateTime) => {
  const params = {
    TableName: config.AWS_DYNAMODB_TABLE,
    ExpressionAttributeNames: {
      "#removed": columns.removed.name,
    },
    ExpressionAttributeValues: {
      ":removed": {
        [columns.removed.type]: true,
      },
    },
    Key: {
      [columns.category.name]: {
        [columns.category.type]: currentCategory,
      },
      [columns.updateTime.name]: {
        [columns.updateTime.type]: "" + updateTime,
      },
    },
    ReturnValues: "ALL_NEW",
    UpdateExpression: "SET #removed = :removed",
  };

  try {
    const data = await dynamoDB.updateItem(params).promise();
    console.info(`Successfully soft deleted image `, data);
    return config.SUCCESS;
  } catch (error) {
    console.error(`Failed to soft delete image with error `, error);
    throw config.FAILURE;
  }
};

const updateImageIfExists = async (
  dynamoDB,
  currentCategory,
  newCategory,
  description,
  updateTime
) => {
  try {
    const rowItem = await getDynamoRowItem(
      dynamoDB,
      currentCategory,
      updateTime
    );
    rowItem[columns.category.name][columns.category.type] = newCategory;
    rowItem[columns.description.name][columns.description.type] = description;

    await Promise.all([
      softDeleteIfExists(dynamoDB, currentCategory, updateTime),
      record(dynamoDB, rowItem, updateTime + 1),
    ]);
    console.info(`Successfully updated item's metadata `);
    return config.SUCCESS;
  } catch (error) {
    console.info(`failed to update image with error`, error);
    throw config.FAILURE;
  }
};

module.exports = {
  checkIfBiotcExists,
  softDeleteExistingBiotcImage,
  deleteImagesFromS3,
  record,
  getDynamoRowItem,
  compressAndStore,
  softDeleteIfExists,
  updateImageIfExists,
};
