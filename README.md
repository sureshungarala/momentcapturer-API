## Serves APIs for momentcapturer.com via sub-domain api.momentcapturer.com

- Uses [Sharp](https://github.com/lovell/sharp) module to convert image to `progressive JPEG`s(for now. May be to AVIF / JPEG XL in future considering wider browser compatibility) for multiple device types.

- Serves APIs(_AWS_ **_Lambda_**) over api.momentcapturer.com(Set through **_API Gateway_**).

- Stores processed images in _AWS_ **_S3_** bucket and cached for 1 year.

- Records uploaded image metadata in _AWS_ **_DynamoDB_**.

- For serverless config, check out [moment-capturer](https://github.com/sureshUngarala/moment-capturer) repo.

### Deployment (from macOS to AWS Lambda ARM64)

The `sharp` library uses native binaries that are platform-specific. When deploying from macOS to AWS Lambda (Linux ARM64), npm only installs macOS binaries by default.

**Solution**: Manually extract Linux ARM64 binaries before deployment:

```bash
# After npm install, manually add Linux binaries:
npm pack @img/sharp-linux-arm64@0.33.5
tar -xzf img-sharp-linux-arm64-0.33.5.tgz
mv package node_modules/@img/sharp-linux-arm64
rm img-sharp-linux-arm64-0.33.5.tgz

npm pack @img/sharp-libvips-linux-arm64@1.0.4
tar -xzf img-sharp-libvips-linux-arm64-1.0.4.tgz
mv package node_modules/@img/sharp-libvips-linux-arm64
rm img-sharp-libvips-linux-arm64-1.0.4.tgz

# Then deploy
serverless deploy
```

> **Note**: Keep `sharp` version in `package.json` aligned with the binary versions above.

### S3 CORS Configuration (for Pre-Signed URL Uploads)

The `getUploadUrl` endpoint generates pre-signed URLs that allow browsers to upload directly to S3. For this to work, the S3 bucket must have CORS configured to allow `PUT` requests from the frontend origin.

**Apply CORS configuration:**

```bash
aws s3api put-bucket-cors --bucket moments-redefined --profile personal --cors-configuration file://cors-config.json
```

**Verify CORS:**

```bash
aws s3api get-bucket-cors --bucket moments-redefined --profile personal
```

**Required CORS rules** (see `cors-config.json`):

- `AllowedMethods`: Must include `PUT` (in addition to `GET`)
- `AllowedOrigins`: Must include `https://momentcapturer.com`
- `AllowedHeaders`: `*` (to allow Content-Type header)

> **Why is this needed?** When browsers make cross-origin requests directly to S3 (e.g., uploading via pre-signed URL), S3 enforces CORS. Server-side uploads from Lambda don't require CORS since they're server-to-server.

#### Credits:

- https://serverless.com/blog/serverless-api-gateway-domain/
