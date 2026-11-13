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
    readonly input: ListObjectsV2Input;
  }

  export class S3Client {
    static instances: S3Client[];
    readonly options: S3ClientOptions;
    readonly commands: unknown[];
    constructor(options: S3ClientOptions);
    send(command: ListObjectsV2Command): Promise<unknown>;
  }
}
