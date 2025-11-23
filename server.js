import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize API clients
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
}) : null;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

const google = process.env.GOOGLE_API_KEY ? new GoogleGenerativeAI(
  process.env.GOOGLE_API_KEY
) : null;

// Model configurations
const MODELS = {
  'gemini-3': {
    provider: 'google',
    displayName: 'Gemini 3',
    modelId: 'gemini-3-pro-preview',
    supportsThinking: true
  },
  'claude-4-1-opus': {
    provider: 'anthropic',
    displayName: 'Claude 4.1 Opus',
    modelId: 'claude-opus-4-1-20250805',
    supportsThinking: true
  },
  'gpt-5-1': {
    provider: 'openai',
    displayName: 'GPT-5.1',
    modelId: 'gpt-5.1-2025-11-13',
    supportsThinking: true
  },
};



// Stream Anthropic API
async function streamAnthropic(modelConfig, prompt, onChunk, systemPrompt = null) {
  if (!anthropic) {
    throw new Error('Anthropic API key not configured');
  }

  const messages = [{ role: 'user', content: prompt }];

  const params = {
    model: modelConfig.modelId,
    max_tokens: 4096,
    messages: messages,
    stream: true,
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  const stream = await anthropic.messages.create(params);

  let fullText = '';

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      const text = chunk.delta.text;
      fullText += text;
      onChunk(text);
    }
  }

  return {
    text: fullText,
    thinking: '', // Streaming thinking not supported in this simple implementation yet
    model: modelConfig.displayName
  };
}

// Stream OpenAI API
async function streamOpenAI(modelConfig, prompt, onChunk, systemPrompt = null) {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: prompt });

  const stream = await openai.chat.completions.create({
    model: modelConfig.modelId,
    messages: messages,
    max_completion_tokens: 4096,
    stream: true,
  });

  let fullText = '';

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }

  return {
    text: fullText,
    thinking: '',
    model: modelConfig.displayName
  };
}

// Stream Google Gemini API
async function streamGemini(modelConfig, prompt, onChunk, systemPrompt = null) {
  if (!google) {
    throw new Error('Google API key not configured');
  }

  const model = google.getGenerativeModel({
    model: modelConfig.modelId,
    systemInstruction: systemPrompt || undefined
  });

  const generationConfig = {
    maxOutputTokens: 4096,
  };

  const result = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig
  });

  let fullText = '';

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }

  return {
    text: fullText,
    thinking: '',
    model: modelConfig.displayName
  };
}

// Generic model streamer
async function streamModel(modelKey, prompt, onChunk, systemPrompt = null) {
  const modelConfig = MODELS[modelKey];

  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelKey}`);
  }

  if (modelConfig.provider === 'anthropic') {
    return await streamAnthropic(modelConfig, prompt, onChunk, systemPrompt);
  } else if (modelConfig.provider === 'openai') {
    return await streamOpenAI(modelConfig, prompt, onChunk, systemPrompt);
  } else if (modelConfig.provider === 'google') {
    return await streamGemini(modelConfig, prompt, onChunk, systemPrompt);
  } else {
    throw new Error(`Unknown provider: ${modelConfig.provider}`);
  }
}

// Generic model caller (wraps streamer for backward compatibility)
async function callModel(modelKey, prompt, systemPrompt = null) {
  let fullText = '';
  const result = await streamModel(modelKey, prompt, (chunk) => {
    fullText += chunk;
  }, systemPrompt);

  return {
    ...result,
    text: fullText
  };
}

// API endpoint to get available models
app.get('/api/models', (req, res) => {
  const availableModels = {};

  for (const [key, config] of Object.entries(MODELS)) {
    if (config.provider === 'anthropic' && anthropic) {
      availableModels[key] = config;
    } else if (config.provider === 'openai' && openai) {
      availableModels[key] = config;
    } else if (config.provider === 'google' && google) {
      availableModels[key] = config;
    }
  }

  res.json(availableModels);
});

// API endpoint to submit prompt to multiple models (with streaming)
// API endpoint to submit prompt to multiple models (with streaming)
app.post('/api/query', async (req, res) => {
  try {
    const { prompt, models, defaultModel, previousRoundContext } = req.body;

    if (!prompt || !models || models.length === 0) {
      return res.status(400).json({ error: 'Prompt and models are required' });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const results = [];
    let promptsToUse = {}; // Map modelKey -> prompt

    // If this is a resubmission (Round 2+), generate custom prompts first
    if (previousRoundContext) {
      const { originalPrompt, previousResponses, inconsistencyAnalysis, additionalInstructions } = previousRoundContext;

      // Generate follow-up prompts for each model
      const promptGenerationPromises = models.map(async (modelKey) => {
        const prevResponse = previousResponses.find(r => r.modelKey === modelKey);
        const prevResponseText = prevResponse ? prevResponse.text : "No response in previous round.";

        let instructionsPart = '';
        if (additionalInstructions) {
          instructionsPart = `4. Incorporate the following specific instructions/questions: "${additionalInstructions}"`;
        }

        const generationPrompt = `You are coordinating a discussion between AI models to resolve inconsistencies.
        
Original Prompt: "${originalPrompt}"

Inconsistency Analysis:
${inconsistencyAnalysis}

This model (${modelKey}) previously answered:
${prevResponseText}

Please frame a follow-up prompt for ${modelKey} that:
1. Points out the agreements and disagreements between its response and the other models (based on the analysis).
2. Asks it to reconsider or clarify its position in light of this information.
3. Is direct and specific.
${instructionsPart}

Return ONLY the prompt text to send to the model.`;

        try {
          const response = await callModel(defaultModel, generationPrompt);
          const generatedPrompt = response.text.trim();
          promptsToUse[modelKey] = generatedPrompt;

          // Stream the generated prompt to the client
          res.write(JSON.stringify({
            type: 'generated_prompt',
            data: { modelKey, prompt: generatedPrompt }
          }) + '\n');
        } catch (error) {
          console.error(`Error generating prompt for ${modelKey}:`, error);
          promptsToUse[modelKey] = prompt; // Fallback to original prompt
        }
      });

      await Promise.all(promptGenerationPromises);
    } else {
      // Round 1: Use the original prompt for all models
      models.forEach(key => promptsToUse[key] = prompt);
    }

    // Call all selected models in parallel, but stream results as they complete
    const modelPromises = models.map(async (modelKey) => {
      try {
        const modelPrompt = promptsToUse[modelKey];
        const response = await callModel(modelKey, modelPrompt);
        const result = { modelKey, success: true, ...response };
        results.push(result);

        // Stream this result immediately
        res.write(JSON.stringify({ type: 'result', data: result }) + '\n');
      } catch (error) {
        const result = { modelKey, success: false, error: error.message };
        results.push(result);

        // Stream this error immediately
        res.write(JSON.stringify({ type: 'result', data: result }) + '\n');
      }
    });

    // Wait for all models to complete
    await Promise.all(modelPromises);

    // Analyze inconsistencies using the default model
    const successfulResults = results.filter(r => r.success);

    if (successfulResults.length > 1 && defaultModel) {
      const analysisPrompt = `You are analyzing responses from multiple AI models to the same prompt. Please identify any inconsistencies or disagreements between the responses.

The prompt was submitted to: ${models.join(', ')}.
Responses received: ${successfulResults.length}/${models.length}.

Original prompt: "${prompt}"

Responses:
${successfulResults.map((r) => `
${r.model}:
${r.text}
`).join('\n---\n')}

Please provide a response in the following format:
1. A color code: RED (total disagreement), YELLOW (partial agreement/disagreement), or GREEN (complete agreement).
2. A detailed analysis in Markdown format.

Start your response with the color code on the first line (e.g., "COLOR: RED"), followed by the analysis.
The analysis should explain the inconsistencies and how they were generated.`;

      try {
        let fullText = '';
        let agreementLevel = 'yellow';
        let colorParsed = false;

        // Send initial analysis start message
        res.write(JSON.stringify({
          type: 'analysis_start',
          data: { timestamp: new Date().toISOString() }
        }) + '\n');

        await streamModel(defaultModel, analysisPrompt, (chunk) => {
          fullText += chunk;

          // Try to parse color if not yet parsed
          if (!colorParsed) {
            const colorMatch = fullText.match(/^COLOR:\s*(RED|YELLOW|GREEN)/i);
            if (colorMatch) {
              agreementLevel = colorMatch[1].toLowerCase();
              colorParsed = true;

              // Send agreement level update
              res.write(JSON.stringify({
                type: 'analysis_agreement',
                data: { agreementLevel }
              }) + '\n');

              // Remove the color line from the displayed text
              // We only stream the content AFTER the color line
              const contentStart = fullText.indexOf('\n');
              if (contentStart !== -1) {
                // We have passed the color line, stream the rest
                // But we need to be careful not to re-stream what we already processed
                // For simplicity in this streaming implementation, we'll handle the display cleanup on the client
                // or just stream the raw chunk and let client handle it.
                // Actually, let's just stream the raw chunk and let the client parse/hide the color line.
              }
            }
          }

          res.write(JSON.stringify({
            type: 'analysis_chunk',
            data: { chunk }
          }) + '\n');
        });

      } catch (error) {
        console.error('Error analyzing inconsistencies:', error);
        res.write(JSON.stringify({
          type: 'error',
          data: { error: 'Error generating analysis: ' + error.message }
        }) + '\n');
      }
    }

    // End the stream
    res.end();
  } catch (error) {
    console.error('Error processing query:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ type: 'error', data: { error: error.message } }) + '\n');
      res.end();
    }
  }
});

// API endpoint to generate follow-up critique
app.post('/api/critique', async (req, res) => {
  try {
    const { originalPrompt, results, defaultModel } = req.body;

    if (!originalPrompt || !results || !defaultModel) {
      return res.status(400).json({ error: 'Original prompt, results, and default model are required' });
    }

    const critiquePrompt = `You are providing detailed feedback on multiple AI model responses. Please generate a response that points out where different models disagreed or were inconsistent.

Original prompt: "${originalPrompt}"

Model responses:
${results.map((r) => `
${r.model}:
${r.text}
`).join('\n---\n')}

Please provide a detailed critique that:
1. Points out specific inconsistencies between the models
2. Explains which model's approach might be more accurate or appropriate (if applicable)
3. Highlights any areas where models agreed
4. Suggests which response(s) might be most reliable

Be specific and cite examples from the responses.`;

    const critique = await callModel(defaultModel, critiquePrompt);

    res.json({
      critique: critique.text,
      thinking: critique.thinking,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating critique:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Anthropic API: ${anthropic ? 'Configured' : 'Not configured'}`);
  console.log(`OpenAI API: ${openai ? 'Configured' : 'Not configured'}`);
  console.log(`Google API: ${google ? 'Configured' : 'Not configured'}`);
});
