import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'fs'
import path from 'path'

const USE_R2 =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY

let s3Client: S3Client | null = null

if (USE_R2) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

const LOCAL_UPLOADS_DIR = process.env.UPLOADS_DIR ?? './uploads'

export async function uploadNetworkFile(
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  if (USE_R2 && s3Client) {
    const key = `networks/${filename}`
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME ?? 'risp-networks',
        Key: key,
        Body: fileBuffer,
        ContentType: 'application/json',
      })
    )
    // R2_PUBLIC_URL: the public bucket URL, e.g. https://pub-xxx.r2.dev or a custom domain
    return `${process.env.R2_PUBLIC_URL}/${key}`
  }

  await fs.mkdir(LOCAL_UPLOADS_DIR, { recursive: true })
  const localPath = path.join(LOCAL_UPLOADS_DIR, filename)
  await fs.writeFile(localPath, fileBuffer)
  const port = process.env.PORT ?? '3001'
  return `http://localhost:${port}/uploads/${filename}`
}
