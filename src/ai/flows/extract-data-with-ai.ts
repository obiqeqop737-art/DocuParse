'use server';
/**
 * @fileOverview A Genkit flow for intelligently parsing technical documents and extracting key information based on predefined rules.
 *
 * - extractDataWithAI - A function that handles the data extraction process using AI.
 * - ExtractDataWithAIInput - The input type for the extractDataWithAI function.
 * - ExtractDataWithAIOutput - The return type for the extractDataWithAI function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractDataWithAIInputSchema = z.object({
  documentContent: z.string().describe('The full text content of the technical document to be parsed.'),
  extractionRules: z.string().describe('A natural language description of the key information to extract. For example: "Extract Document Title, Version, Author, and Date of Issue."'),
});
export type ExtractDataWithAIInput = z.infer<typeof ExtractDataWithAIInputSchema>;

const ExtractDataWithAIOutputSchema = z.record(z.string(), z.string()).describe('A JSON object containing the extracted key-value pairs from the document. Keys are the field names and values are the corresponding extracted data.');
export type ExtractDataWithAIOutput = z.infer<typeof ExtractDataWithAIOutputSchema>;

export async function extractDataWithAI(input: ExtractDataWithAIInput): Promise<ExtractDataWithAIOutput> {
  return extractDataWithAIFlow(input);
}

const extractDataPrompt = ai.definePrompt({
  name: 'extractDataPrompt',
  input: { schema: ExtractDataWithAIInputSchema },
  output: { schema: ExtractDataWithAIOutputSchema },
  prompt: `You are an expert technical document parser. Your task is to extract specific key information from the provided technical document based on the given extraction rules.

Document Content:
"""
{{{documentContent}}}
"""

Extraction Rules:
"""
{{{extractionRules}}}
"""

Carefully read the document content and identify the information specified in the extraction rules.
Output the extracted information as a JSON object, where the keys are the names of the fields to extract (as suggested by the extraction rules) and the values are the corresponding extracted data.
If a piece of information cannot be found, provide an empty string for its value.
Ensure the output is a valid JSON object.

Example Output Structure (based on rules like "Extract Document Title, Version, Author, Date of Issue"):
{
  "Document Title": "Example Technical Specification",
  "Version": "1.0",
  "Author": "John Doe",
  "Date of Issue": "2023-10-26"
}
`,
});

const extractDataWithAIFlow = ai.defineFlow(
  {
    name: 'extractDataWithAIFlow',
    inputSchema: ExtractDataWithAIInputSchema,
    outputSchema: ExtractDataWithAIOutputSchema,
  },
  async (input) => {
    const { output } = await extractDataPrompt(input);
    if (!output) {
      throw new Error('Failed to extract data: AI did not return an output.');
    }
    return output;
  }
);
