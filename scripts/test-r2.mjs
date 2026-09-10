/**
 * 测试 R2 存储连接
 * 运行: node scripts/test-r2.mjs
 */

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME
const R2_ENDPOINT = process.env.R2_ENDPOINT

console.log('R2 配置检查:')
console.log('R2_ACCOUNT_ID:', R2_ACCOUNT_ID ? '✓ 已设置' : '✗ 未设置')
console.log('R2_ACCESS_KEY_ID:', R2_ACCESS_KEY_ID ? '✓ 已设置' : '✗ 未设置')
console.log('R2_SECRET_ACCESS_KEY:', R2_SECRET_ACCESS_KEY ? '✓ 已设置' : '✗ 未设置')
console.log('R2_BUCKET_NAME:', R2_BUCKET_NAME ? '✓ 已设置' : '✗ 未设置')
console.log('R2_ENDPOINT:', R2_ENDPOINT ? '✓ 已设置' : '✗ 未设置')

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_ENDPOINT) {
  console.error('\n❌ R2 配置不完整，请检查环境变量')
  process.exit(1)
}

async function testR2() {
  console.log('\n测试 R2 连接...')

  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3')

  const client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  })

  const testKey = `test/connection-test-${Date.now()}.txt`
  const testContent = `R2 连接测试 - ${new Date().toISOString()}`

  try {
    // 上传测试文件
    console.log('上传测试文件...')
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
    }))
    console.log('✓ 文件上传成功')

    // 列出文件
    console.log('列出文件...')
    const listResult = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: 'test/',
      MaxKeys: 5,
    }))
    console.log(`✓ 列出成功，找到 ${listResult.Contents?.length || 0} 个文件`)

    // 删除测试文件
    console.log('删除测试文件...')
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: testKey,
    }))
    console.log('✓ 文件删除成功')

    console.log('\n✅ R2 配置正确，存储功能正常！')
  } catch (error) {
    console.error('\n❌ R2 测试失败:', error.message)
    process.exit(1)
  }
}

testR2()
