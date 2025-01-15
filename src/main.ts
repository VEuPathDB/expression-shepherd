import OpenAI from "openai";
import 'dotenv/config';
import { expressionDataRequestPostData } from "./post-templates/expression_data_request";

//
// yarn build && yarn start PF3D7_0616000
//

const args = process.argv.slice(2); // Skip the first two entries
const geneId = args[0];

console.log(`Going to work on gene ${geneId}...`);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in your environment
});


// get the gene ID into the POST data template
const postData = {
  ...expressionDataRequestPostData,
  primaryKey: expressionDataRequestPostData.primaryKey.map((pk) => ({
    ...pk,
    value: pk.value.replace('####', geneId),
  })),
};



console.log(postData);



async function getCompletion() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: "Write a haiku about recursion in programming.",
        },
      ],
    });

    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.error("Error generating completion:", error);
  }
}


// getCompletion();

