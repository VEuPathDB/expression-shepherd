import request from 'sync-request';

export function get_ncbi_attributes(id: string, lookup: Map<string, string[]>): string[] {
  const accessions = lookup.get(id);
  if (!accessions) return [];

  const biosampleTexts: string[] = [];

  for (const accession of accessions) {
    let biosampleId: string | null = null;

    try {
      const sraRes = request('GET', `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi`, {
        qs: { db: 'sra', id: accession },
        timeout: 10000,
        retry: true,  // automatic retry on failure
      });
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

    try {
      const bioRes = request('GET', `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi`, {
        qs: { db: 'biosample', id: biosampleId, retmode: 'text' },
        timeout: 10000,
        retry: true,
      });
      const text = bioRes.getBody('utf-8');
      biosampleTexts.push(text.replace(/\s+/g, ' ').replace(/"/g, "'").replace(/.+(?=Organism:)/, '').replace(/(?:Accession|Description):.+/, ''));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to fetch BioSample ${biosampleId}:`, message);
    }
  }

  return biosampleTexts;
}

