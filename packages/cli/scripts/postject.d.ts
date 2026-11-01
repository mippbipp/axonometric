// postject ships no types. This covers the one function build-sea.ts calls.
declare module "postject" {
  export interface InjectOptions {
    readonly sentinelFuse?: string;
    readonly machoSegmentName?: string;
    readonly overwrite?: boolean;
  }

  // oxlint-disable-next-line eslint/max-params -- postject's own signature
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Uint8Array,
    options?: InjectOptions
  ): Promise<void>;
}
