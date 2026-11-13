/** Isolated stand-in for GutTS's provider-specific S3 public entrypoint. */
export interface ListObjectsV2Input {
  Bucket: string;
  MaxKeys: number;
}

export class ListObjectsV2Command {
  constructor(readonly input: ListObjectsV2Input) {}
}

export interface S3ClientOptions {
  endpoint?: string;
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  forcePathStyle?: boolean;
}

export class S3Client {
  static instances: S3Client[] = [];
  readonly commands: unknown[] = [];

  constructor(readonly options: S3ClientOptions) {
    S3Client.instances.push(this);
  }

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    return {};
  }
}
