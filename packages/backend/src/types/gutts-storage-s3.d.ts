declare module '@dinilmusick/gutts/storage/s3' {
  export interface S3ClientOptions {
    endpoint?: string;
    region?: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
    forcePathStyle?: boolean;
  }

  export interface ListObjectsV2Input {
    Bucket: string;
    MaxKeys: number;
  }

  export class ListObjectsV2Command {
    constructor(input: ListObjectsV2Input);
  }

  export class S3Client {
    constructor(options: S3ClientOptions);
    send(command: ListObjectsV2Command): Promise<unknown>;
  }
}
