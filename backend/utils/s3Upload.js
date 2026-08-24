const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

/**
 * Region must match the bucket’s AWS region (see S3 console → bucket → Properties).
 * Prefer AWS_S3_REGION when it differs from other services using AWS_REGION.
 */
function resolveS3Region() {
  return (
    process.env.AWS_S3_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "ap-south-1"
  )
    .trim()
    .toLowerCase();
}

function getS3Client() {
  const accessKeyId = process.env.ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const region = resolveS3Region();

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  const endpoint = (process.env.AWS_S3_ENDPOINT || "").trim();
  const followRegionRedirects =
    process.env.AWS_S3_FOLLOW_REGION_REDIRECTS !== "false";

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    /** Fixes "must be addressed using the specified endpoint" (PermanentRedirect) when region was wrong. */
    followRegionRedirects,
    ...(endpoint ? { endpoint } : {}),
    ...(process.env.S3_FORCE_PATH_STYLE === "true" ? { forcePathStyle: true } : {}),
  });
}

function getDefaultBucket() {
  return (
    process.env.BUCKET_NAME ||
    process.env.AWS_S3_BUCKET ||
    process.env.S3_BUCKET ||
    ""
  ).trim();
}

/**
 * @param {object} opts
 * @param {string} opts.bucket
 * @param {string} opts.key - S3 object key (no leading slash)
 * @param {Buffer} opts.body
 * @param {string} [opts.contentType]
 * @returns {Promise<{ bucket: string, key: string, url: string }>}
 */
async function putObject({ bucket, key, body, contentType = "application/octet-stream" }) {
  const client = getS3Client();
  if (!client) {
    throw new Error("S3 credentials missing: set ACCESS_KEY and SECRET_KEY (or AWS_* env vars).");
  }
  if (!bucket) {
    throw new Error("S3 bucket missing: set BUCKET_NAME or AWS_S3_BUCKET.");
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key.replace(/^\//, ""),
      Body: body,
      ContentType: contentType,
    })
  );

  const url = buildObjectUrl(bucket, key.replace(/^\//, ""));
  return { bucket, key: key.replace(/^\//, ""), url };
}

function buildObjectUrl(bucket, key) {
  const base = (process.env.AWS_S3_PUBLIC_URL_BASE || "").trim().replace(/\/$/, "");
  if (base) {
    return `${base}/${key}`;
  }
  const region = resolveS3Region();
  if (region === "us-east-1") {
    return `https://${bucket}.s3.amazonaws.com/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function isS3Configured() {
  return Boolean(getS3Client() && getDefaultBucket());
}

module.exports = {
  getS3Client,
  getDefaultBucket,
  putObject,
  buildObjectUrl,
  isS3Configured,
  resolveS3Region,
};
