export interface VersionedStaticOverride {
  status: number;
  body?: string;
  contentType?: string;
}

export interface VersionedStaticServerOptions {
  root?: string;
  versions?: Record<string, string>;
  active?: string;
  host?: string;
  port?: number;
  allowImmutableCache?: boolean;
}

export interface VersionedStaticServer {
  url: string;
  switch(version: string): void;
  override(pathname: string, response: VersionedStaticOverride | null): void;
  failWasm(enabled: boolean): void;
  close(): Promise<void>;
}

export function startVersionedStaticServer(options: VersionedStaticServerOptions): Promise<VersionedStaticServer>;
