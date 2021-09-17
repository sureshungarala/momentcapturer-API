## Serves APIs for momentcapturer.com via sub-domain api.momentcapturer.com

- Uses [Sharp](https://github.com/lovell/sharp) module to convert image to `progressive JPEG`s(for now. May be to AVIF in future considering wider browser compatibility) for multiple device types.

- Serves APIs(_AWS_ **_Lambda_**) over api.momentcapturer.com(Set through **_API Gateway_**).

- Stores processed images in _AWS_ **_S3_** bucket and cached for 1 year.

- Records uploaded image metadata in _AWS_ **_DynamoDB_**.

- For serverless config, check out [moment-capturer](https://github.com/sureshUngarala/moment-capturer) repo.

#### Credits:

- https://serverless.com/blog/serverless-api-gateway-domain/
