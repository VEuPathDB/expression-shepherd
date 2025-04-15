import request from 'sync-request';

export function get_ncbi_attributes(id: string, lookup: Map<string, string[]>): string[] {
  const accessions = lookup.get(id);
  if (!accessions) return [];

  const biosampleTexts: string[] = [];
  
  for (const accession of accessions) {
    let biosampleId: string | null = null;
    console.log(`NCBI efetch for SRA ${accession}...`);
    try {
      const sraRes = request('GET', `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi`, {
        qs: { db: 'sra', id: accession },
        timeout: 10000,
	maxRetries: 3,
	retryDelay: 1000,
	retry: true
      });
      console.log(`NCBI responded for SRA ${accession}...`);
      const xml = sraRes.getBody('utf-8');
      const match = xml.match(/<EXTERNAL_ID\s+namespace="BioSample">(SAMN\d+)<\/EXTERNAL_ID>/);
      if (!match) continue;

      biosampleId = match[1];
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to fetch SRA data for accession ${accession}:`, message);
      continue;
    }

    if (!biosampleId) continue;

    console.log(`NCBI efetch for BioSample ${biosampleId}...`);
    try {
      const bioRes = request('GET', `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi`, {
        qs: { db: 'biosample', id: biosampleId, retmode: 'text' },
        timeout: 10000,
	maxRetries: 3,
	retryDelay: 1000,
        retry: true,
      });
      console.log(`NCBI responded for BioSample ${biosampleId}...`);
      const text = bioRes.getBody('utf-8');
      // (. does not match newlines by default)
      biosampleTexts.push(text.replace(/\/replicate=.+/, '').replace(/\s+/g, ' ').replace(/"/g, "'").replace(/.+(?=Organism:)/, '').replace(/(?:Accession|Description):.+/, ''));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to fetch BioSample ${biosampleId}:`, message);
    }
  }

  return biosampleTexts;
}

