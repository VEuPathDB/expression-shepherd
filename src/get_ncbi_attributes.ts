import axios from 'axios';

export async function get_ncbi_attributes_async(id: string, lookup: Map<string, string[]>): Promise<string[]> {
  const accessions = lookup.get(id);
  if (!accessions) return [];

  const biosampleTexts: string[] = [];

  for (const accession of accessions) {
    let biosampleId: string | null = null;

    try {
      console.log(`NCBI efetch for SRA ${accession}...`);
      const sraRes = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
        params: { db: 'sra', id: accession },
        timeout: 10000,
      });
      console.log(`NCBI responded for SRA ${accession}...`);
      const xml = sraRes.data;
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
      console.log(`NCBI efetch for BioSample ${biosampleId}...`);
      const bioRes = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
        params: { db: 'biosample', id: biosampleId, retmode: 'text' },
        timeout: 10000,
      });
      console.log(`NCBI responded for BioSample ${biosampleId}...`);
      const text = bioRes.data;
      biosampleTexts.push(
        text.replace(/\/replicate=.+/, '')
            .replace(/\s+/g, ' ')
            .replace(/"/g, "'")
            .replace(/.+(?=Organism:)/, '')
            .replace(/(?:Accession|Description):.+/, '')
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to fetch BioSample ${biosampleId}:`, message);
    }
  }

  return biosampleTexts;
}
