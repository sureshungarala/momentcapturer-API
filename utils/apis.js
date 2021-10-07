const AWS = require("aws-sdk");
const Q = require("q");
const sharp = require("sharp");
const columns = require("../config/columns.json");
const config = require("../config/config.json");
const { getResolution, extractFileNameFromUrl } = require("./helpers");
/**
 *
 * @param {Object DynamoDB_Constructor} dynamoDB
 * @param {String image_category} category
 */
const checkIfBiotcExists = async (dynamoDB, category) => {
  let defer = Q.defer();
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

  dynamoDB.query(getParams, (err, data) => {
    if (err) {
      console.error("Failed to getItem from DynamoDB with error: ", err);
      defer.reject(config.FAILURE);
    } else {
      const unmarshalled = data.Items.map(AWS.DynamoDB.Converter.unmarshall)[0]; // BIOTC image
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
      defer.resolve(item);
    }
  });
  return defer.promise;
};

/**
 *
 * @param {Object DynamoDB_Constructor} dynamoDB
 * @param {Number} lastUpdatedTime
 * @param {String} category
 */
const softDeleteExistingBiotcImage = async (
  dynamoDB,
  lastUpdatedTime,
  category
) => {
  let defer = Q.defer();
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
  dynamoDB.updateItem(updateParams, (error, data) => {
    if (error) {
      console.error(
        "Failed to update existing biotc to false with error ",
        error
      );
      defer.reject(config.FAILURE);
    } else {
      console.info(`Successully 'soft deleted' existing biotc `, data);
      defer.resolve(config.SUCCESS);
    }
  });
  return defer.promise;
};

/**
 *
 * @param {Object S3_constructor} s3
 * @param {Array S3_deleteObjects_param} Objects
 */
const deleteImagesFromS3 = async (s3, Objects) => {
  let defer = Q.defer();
  s3.deleteObjects(
    {
      Bucket: config.AWS_S3_BUCKET_NAME,
      Delete: {
        Objects,
        Quiet: true,
      },
    },
    (error, data) => {
      if (error) {
        console.error("Failed to delete imgaes from S3 with error ", error);
        defer.reject(config.FAILURE);
      } else {
        console.info(
          "Successfully deleted images: ",
          Objects,
          " :from S3 with metadata: ",
          data
        );
        defer.resolve(config.SUCCESS);
      }
    }
  );
  return defer.promise;
};

/**
 *
 * @param {Object DynamoDB_Constructor} dynamoDB
 * @param {Object DynamoRowItem} Item
 * @param {Number} updateTime
 */
const record = (dynamoDB, dynamoRowItem, updateTime) => {
  let defer = Q.defer();
  dynamoRowItem[columns.uploadTime.name][columns.uploadTime.type] =
    "" + new Date().getTime();
  dynamoRowItem[columns.updateTime.name][columns.updateTime.type] =
    "" + (updateTime ? updateTime : new Date().getTime());

  dynamoDB.putItem(
    {
      TableName: config.AWS_DYNAMODB_TABLE,
      Item: dynamoRowItem,
    },
    (error, data) => {
      if (error) {
        console.error(`Failed to record item to DynamoDB with error `, error);
        defer.reject(config.FAILURE);
      } else {
        console.info(
          `Successfully recorded item into DynamoDB with metadata `,
          data
        );
        defer.resolve(config.SUCCESS);
      }
    }
  );
  return defer.promise;
};

const compressAndStore = (
  { s3, imageBuffer, dynamoRowItem, fileName, params, currentTimeInMs },
  device
) => {
  let defer = Q.defer();
  sharp(imageBuffer, {
    density: 515,
  })
    .jpeg({
      quality: 80,
      progressive: true,
      chromaSubsampling: "4:4:4",
      optimiseScans: true,
    })
    .resize({
      //default aspect ratio 3:2
      width: getResolution(device, config.WIDTH, params),
      height: getResolution(device, config.HEIGHT, params),
      fit: "contain",
      background: "rgb(255, 255, 255, 1)", //alpha is transparency '0' is 100% transp...so, rgb doesn't matter when alpha is 0
    })
    .toBuffer((err, buffer, info) => {
      const Key = `${fileName}-${
        params.biotc ? columns.biotc.name + "-" + device : device
      }-${currentTimeInMs}.jpeg`;
      if (!err) {
        console.info(`Successfully compressed for ${device} with info `, info);
        s3.upload(
          {
            Key,
            Body: buffer,
            Bucket: config.AWS_S3_BUCKET_NAME,
            CacheControl: "public, max-age=31536000",
            ContentType: "image/jpeg",
          },
          (error, data) => {
            if (error) {
              console.error(
                `Failed to upload ${Key} to s3 with error: `,
                error
              );
              defer.reject(config.FAILURE);
            } else {
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
              console.info(
                `Successfully uploaded ${Key} to s3 with metadata `,
                data
              );
              defer.resolve(config.SUCCESS);
            }
          }
        );
      } else {
        console.error(`Failed to compress for ${device} with error `, err);
        defer.reject(config.FAILURE);
      }
    });
  return defer.promise;
};

/**
 * fetches dynamodb row item matching category and updateTime
 * @param {Object DynamoDB_Constructor} DynamoDB
 * @param {String} category
 * @param {Number} updateTime
 */
const getDynamoRowItem = (dynamoDB, category, updateTime) => {
  let defer = Q.defer();
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

  dynamoDB.getItem(params, (err, data) => {
    if (err) {
      console.error(
        `Failed to get matching item from DynamoDB with error `,
        err
      );
      defer.reject(config.FAILURE);
    } else {
      console.info(`Successfully fetched item from DynamoDB `, data);
      defer.resolve(data.Item);
    }
  });
  return defer.promise;
};

const softDeleteIfExists = (dynamoDB, currentCategory, updateTime) => {
  let defer = Q.defer();
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

  dynamoDB.updateItem(params, (error, data) => {
    if (error) {
      console.error(`Failed to soft delete image with error `, error);
      defer.reject(config.FAILURE);
    } else {
      console.info(`Successfully soft deleted image `, data);
      defer.resolve(config.SUCCESS);
    }
  });
  return defer.promise;
};

const updateImageIfExists = async (
  dynamoDB,
  currentCategory,
  newCategory,
  description,
  updateTime
) => {
  let defer = Q.defer();
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
      record(dynamoDB, rowItem, updateTime + 1), // only adding 1ms to differentiate from original
    ]);
    console.info(`Successfully updated item's metadata `);
    defer.resolve(config.SUCCESS);
  } catch (error) {
    console.info(`failed to update image with error`, error);
    defer.reject(config.FAILURE);
  }
  return defer.promise;
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
