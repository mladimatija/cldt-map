/** True where Netlify Blobs is reachable: production, deploy previews, and
 *  `netlify dev` with the blobs context. Plain `next dev` has neither, so the
 *  share shortener answers 503 and the rate limiter keeps buckets in memory.
 *  Dependency-free, so the Netlify functions can import it too. */
export function isBlobsConfigured(): boolean {
	return Boolean(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT);
}
