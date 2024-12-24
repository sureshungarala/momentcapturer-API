const columns = require('../config/columns.json');
const config = require('../config/config.json');

/**
 * Constructs Row Item for DynamoDB
 * @param {*} param0
 * @returns
 */
const constructInitDynamoRowItem = ({
  portrait: isPortrait,
  biotc: isBIOTC,
  panorama: isPanorama,
  category,
  description,
  resolution,
}) => ({
  [columns.category.name]: {
    [columns.category.type]: category,
  },
  [columns.uploadTime.name]: {
    [columns.uploadTime.type]: '',
  },
  [columns.srcSet.name]: {
    [columns.srcSet.type]: {
      [config.HANDHELD_MAX_WIDTH]: {
        [columns.srcSet.subType]: '',
      },
      [config.TABLET_MAX_WIDTH]: {
        [columns.srcSet.subType]: '',
      },
      [config.LAPTOP_MAX_WIDTH]: {
        [columns.srcSet.subType]: '',
      },
    },
  },
  [columns.biotc.name]: {
    [columns.biotc.type]: isBIOTC,
  },
  [columns.panorama.name]: {
    [columns.panorama.type]: isPanorama,
  },
  [columns.portrait.name]: {
    [columns.portrait.type]: isPortrait,
  },
  [columns.original.name]: {
    [columns.original.type]: '',
  },
  [columns.description.name]: {
    [columns.description.type]: description,
  },
  [columns.resolution.name]: {
    [columns.resolution.type]: resolution,
  },
  [columns.updateTime.name]: {
    [columns.updateTime.type]: '',
  },
  [columns.removed.name]: {
    [columns.removed.type]: false,
  },
});

/**
 * Calculates width / height based on device and axis
 * @param {string} device
 * @param {string} axis
 * @param {*} param2
 * @returns
 */
const getResolution = (
  device,
  axis,
  { portrait, resolution, biotc, panorama }
) => {
  const imgResolution = resolution.split(':').map(Number);

  // [TODO]: Keep in sync with client side calculation
  const calculateHeight = (size) =>
    Math.round(Number(size) * (imgResolution[1] / imgResolution[0]));

  if (axis === config.WIDTH) {
    if (portrait) {
      if (device === config.HANDHELD) {
        return Math.min(config.LANDSCAPE_HANDHELD_WIDTH, imgResolution[0]);
      } else if (device === config.TABLET) {
        return Math.min(config.LANDSCAPE_TABLET_WIDTH, imgResolution[0]);
      } else if (device === config.LAPTOP) {
        return Math.min(config.LANDSCAPE_LAPTOP_WIDTH, imgResolution[0]);
      } else {
        return imgResolution[0];
      }
    } else if (biotc || panorama) {
      if (device === config.HANDHELD) {
        return config.BITOC_HANDHELD_WIDTH;
      } else if (device === config.TABLET) {
        return config.BITOC_TABLET_WIDTH;
      } else if (device === config.LAPTOP) {
        return config.BITOC_LAPTOP_WIDTH;
      } else {
        return imgResolution[0];
      }
    } else {
      if (device === config.HANDHELD) {
        return config.LANDSCAPE_HANDHELD_WIDTH;
      } else if (device === config.TABLET) {
        return config.LANDSCAPE_TABLET_WIDTH;
      } else if (device === config.LAPTOP) {
        return config.LANDSCAPE_LAPTOP_WIDTH;
      } else {
        return imgResolution[0];
      }
    }
  } else {
    if (portrait) {
      if (device === config.HANDHELD) {
        return calculateHeight(
          Math.min(config.LANDSCAPE_HANDHELD_WIDTH, imgResolution[0])
        );
      } else if (device === config.TABLET) {
        return calculateHeight(
          Math.min(config.LANDSCAPE_TABLET_WIDTH, imgResolution[0])
        );
      } else if (device === config.LAPTOP) {
        return calculateHeight(
          Math.min(config.LANDSCAPE_LAPTOP_WIDTH, imgResolution[0])
        );
      } else {
        return imgResolution[1];
      }
    } else if (biotc || panorama) {
      if (device === config.HANDHELD) {
        return calculateHeight(config.BITOC_HANDHELD_WIDTH);
      } else if (device === config.TABLET) {
        return calculateHeight(config.BITOC_TABLET_WIDTH);
      } else if (device === config.LAPTOP) {
        return calculateHeight(config.BITOC_LAPTOP_WIDTH);
      } else {
        return imgResolution[1];
      }
    } else {
      if (device === config.HANDHELD) {
        return calculateHeight(config.LANDSCAPE_HANDHELD_WIDTH);
      } else if (device === config.TABLET) {
        return calculateHeight(config.LANDSCAPE_TABLET_WIDTH);
      } else if (device === config.LAPTOP) {
        return calculateHeight(config.LANDSCAPE_LAPTOP_WIDTH);
      } else {
        return imgResolution[1];
      }
    }
  }
};

/**
 * Src Map for all API statuses
 */
const API_IDENTIFIERS = {
  CSR: {
    name: 'CSR',
    success: 'Executed CSR :)',
    failure: 'Failed to execute CSR :(',
  },
  FETCH_IMAGES: {
    name: 'FETCH_IMAGES',
    success: 'Successfully fetched data.',
    failure: 'Fetched to fetch data :(',
  },
  FETCH_BEST_IMAGE_PER_CATEGORY: {
    name: 'FETCH_BEST_IMAGE_PER_CATEGORY',
    success: 'Successfully fetched best image per category.',
    failure: 'Failed to fetch best image per category :(',
  },
  FETCH_LATEST_LANDSCAPE_PER_CATEGORY: {
    name: 'FETCH_LATEST_LANDSCAPE_PER_CATEGORY',
    success: 'Successfully fetched latest landscape image per category.',
    failure: 'Failed to fetch latest landscape image per category :(',
  },
  CREATE_TABLE: {
    name: 'CREATE_TABLE',
    success: 'Created DynamoDB table :)',
    failure: 'Failed to create DynamoDB table :(',
  },
  EDIT_IMAGE: {
    name: 'EDIT_IMAGE',
    success: 'Updated image metadata successfully.',
    failure: 'Faild to update image metadata.',
  },
  DELETE_IMAGE: {
    name: 'DELETE_IMAGE',
    success: 'Deleted image successfully.',
    failure: 'Failed to delete image.',
  },
};

/**
 * Responds to client with appropriate data/status code
 * @param {string} apiIdentifier
 * @param {Boolean} success
 * @param {Function} callback
 * @param {Array} images
 * @param {Boolean} cacheAPI
 */
const respond = (apiIdentifier, success, callback, images, cacheAPI) => {
  const response = {
    statusCode: success ? 200 : 500,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(
      {
        message: success
          ? API_IDENTIFIERS[apiIdentifier].success
          : API_IDENTIFIERS[apiIdentifier].failure,
        images,
      },
      null,
      2
    ),
  };
  if (cacheAPI) {
    response.headers['Cache-Control'] = 'no-cache, max-age: 2592000';
  }
  callback(null, response);
};

/**
 * Extracts file name from URL
 * @param {URL} url
 * @returns
 */
const extractFileNameFromUrl = (url) => {
  const imageKeyPrefix = `https://${config.AWS_S3_BUCKET_NAME}.s3.${config.AWS_S3_REGION}.amazonaws.com/`;
  return url.split(imageKeyPrefix)[1];
};

module.exports = {
  constructInitDynamoRowItem,
  getResolution,
  API_IDENTIFIERS,
  extractFileNameFromUrl,
  respond,
};
