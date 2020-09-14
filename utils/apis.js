const AWS = require("aws-sdk");
const Q = require("q");
const sharp = require("sharp");
const columns = require("../config/columns.json");
const config = require("../config/config.json");
const helpers = require("./helpers");
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
        for (let key in unmarshalled[columns.srcSet.name]) {
          objects.push({
            Key: unmarshalled[columns.srcSet.name][key],
          });
        }
        objects.push({
          Key: unmarshalled[columns.original.name],
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
const deleteBiotcImagesFromS3 = async (s3, Objects) => {
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
 */
const record = (dynamoDB, dynamoRowItem) => {
  let defer = Q.defer();
  dynamoRowItem[columns.uploadTime.name][columns.uploadTime.type] =
    "" + new Date().getTime();
  dynamoRowItem[columns.updateTime.name][columns.updateTime.type] =
    "" + new Date().getTime();

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
  { s3, imageBuffer, dynamoRowItem, fileName, params },
  device
) => {
  let defer = Q.defer();
  sharp(imageBuffer, {
    density: 515,
  })
    .jpeg({
      quality: 85,
      progressive: true,
      chromaSubsampling: "4:4:4",
      optimiseScans: true,
    })
    .resize({
      //default aspect ratio 3:2
      width: helpers.getResolution(device, config.WIDTH, params),
      height: helpers.getResolution(device, config.HEIGHT, params),
      fit: "contain",
      background: "rgb(255, 255, 255, 1)", //alpha is transparency '0' is 100% transp...so, rgb doesn't matter when alpha is 0
    })
    .toBuffer((err, buffer, info) => {
      const Key = `${fileName}-${
        params.biotc ? columns.biotc.name + "-" + device : device
      }.jpeg`;
      if (!err) {
        console.info(`Successfully compressed for ${device} with info `, info);
        s3.upload(
          {
            Key,
            Body: buffer,
            Bucket: config.AWS_S3_BUCKET_NAME,
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

module.exports = {
  checkIfBiotcExists,
  softDeleteExistingBiotcImage,
  deleteBiotcImagesFromS3,
  record,
  compressAndStore,
};
