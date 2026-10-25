/**
 * Triggers a browser file download for arbitrary content. Revokes the object
 * URL on a short delay because Safari needs it alive until the click is
 * processed. Shared by every file-export path (GPX, FIT, ICS, HTML brief,
 * DOCX, journal bundle, map PNG, waypoint exports).
 */
export function downloadBlob(content: BlobPart, filename: string, mime: string): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
