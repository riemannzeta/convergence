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
  'claude-3-7-sonnet': {
    provider: 'anthropic',
    displayName: 'Claude 3.7 Sonnet',
    modelId: 'claude-3-7-sonnet-20250219',
    supportsThinking: true
  },
  'claude-3-5-sonnet': {
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    modelId: 'claude-3-5-sonnet-20241022',
    supportsThinking: true
  },
  'claude-3-opus': {
    provider: 'anthropic',
    displayName: 'Claude 3 Opus',
    modelId: 'claude-3-opus-20240229',
    supportsThinking: false
  },
  'gpt-4': {
    provider: 'openai',
    displayName: 'GPT-4',
    modelId: 'gpt-4',
    supportsThinking: false
  },
  'gpt-4-turbo': {
    provider: 'openai',
    displayName: 'GPT-4 Turbo',
    modelId: 'gpt-4-turbo-preview',
    supportsThinking: false
  },
  'gpt-3.5-turbo': {
    provider: 'openai',
    displayName: 'GPT-3.5 Turbo',
    modelId: 'gpt-3.5-turbo',
    supportsThinking: false
  },
  'o1': {
    provider: 'openai',
    displayName: 'OpenAI o1',
    modelId: 'o1',
    supportsThinking: false
  },
  'o1-mini': {
    provider: 'openai',
    displayName: 'OpenAI o1-mini',
    modelId: 'o1-mini',
    supportsThinking: false
  },
  'gemini-2.0-flash-exp': {
    provider: 'google',
    displayName: 'Gemini 2.0 Flash (Experimental)',
    modelId: 'gemini-2.0-flash-exp',
    supportsThinking: true
  },
  'gemini-1.5-pro': {
    provider: 'google',
    displayName: 'Gemini 1.5 Pro',
    modelId: 'gemini-1.5-pro',
    supportsThinking: true
  },
  'gemini-1.5-flash': {
    provider: 'google',
    displayName: 'Gemini 1.5 Flash',
    modelId: 'gemini-1.5-flash',
    supportsThinking: true
  },
  'gemini-1.5-flash-8b': {
    provider: 'google',
    displayName: 'Gemini 1.5 Flash-8B',
    modelId: 'gemini-1.5-flash-8b',
    supportsThinking: true
  }
};

// Call Anthropic API
async function callAnthropic(modelConfig, prompt, systemPrompt = null) {
  if (!anthropic) {
    throw new Error('Anthropic API key not configured');
  }

  const messages = [{ role: 'user', content: prompt }];

  const params = {
    model: modelConfig.modelId,
    max_tokens: 4096,
    messages: messages,
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  // Add thinking support for models that support it
  if (modelConfig.supportsThinking) {
    params.thinking = {
      type: 'enabled',
      budget_tokens: 2000
    };
  }

  const response = await anthropic.messages.create(params);

  let thinkingContent = '';
  let textContent = '';

  for (const block of response.content) {
    if (block.type === 'thinking') {
      thinkingContent = block.thinking;
    } else if (block.type === 'text') {
      textContent += block.text;
    }
  }

  return {
    text: textContent,
    thinking: thinkingContent,
    model: modelConfig.displayName,
    usage: response.usage
  };
}

// Call OpenAI API
async function callOpenAI(modelConfig, prompt, systemPrompt = null) {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: prompt });

  const response = await openai.chat.completions.create({
    model: modelConfig.modelId,
    messages: messages,
    max_tokens: 4096,
  });

  return {
    text: response.choices[0].message.content,
    thinking: '', // OpenAI models don't expose thinking
    model: modelConfig.displayName,
    usage: response.usage
  };
}

// Call Google Gemini API
async function callGemini(modelConfig, prompt, systemPrompt = null) {
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

  // Add thinking support for models that support it
  if (modelConfig.supportsThinking) {
    generationConfig.thinkingConfig = {
      mode: 'THINKING'
    };
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig
  });

  const response = result.response;
  let thinkingContent = '';
  let textContent = '';

  // Extract thinking and text from response
  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.thought) {
        thinkingContent += part.thought + '\n';
      } else if (part.text) {
        textContent += part.text;
      }
    }
  }

  return {
    text: textContent,
    thinking: thinkingContent.trim(),
    model: modelConfig.displayName,
    usage: response.usageMetadata
  };
}

// Generic model caller
async function callModel(modelKey, prompt, systemPrompt = null) {
  const modelConfig = MODELS[modelKey];

  if (!modelConfig) {
    throw new Error(`Unknown model: ${modelKey}`);
  }

  if (modelConfig.provider === 'anthropic') {
    return await callAnthropic(modelConfig, prompt, systemPrompt);
  } else if (modelConfig.provider === 'openai') {
    return await callOpenAI(modelConfig, prompt, systemPrompt);
  } else if (modelConfig.provider === 'google') {
    return await callGemini(modelConfig, prompt, systemPrompt);
  } else {
    throw new Error(`Unknown provider: ${modelConfig.provider}`);
  }
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

// API endpoint to submit prompt to multiple models
app.post('/api/query', async (req, res) => {
  try {
    const { prompt, models, defaultModel } = req.body;

    if (!prompt || !models || models.length === 0) {
      return res.status(400).json({ error: 'Prompt and models are required' });
    }

    // Call all selected models in parallel
    const results = await Promise.all(
      models.map(async (modelKey) => {
        try {
          const response = await callModel(modelKey, prompt);
          return { modelKey, success: true, ...response };
        } catch (error) {
          return { modelKey, success: false, error: error.message };
        }
      })
    );

    // Analyze inconsistencies using the default model
    const successfulResults = results.filter(r => r.success);

    let inconsistencyAnalysis = null;
    if (successfulResults.length > 1 && defaultModel) {
      const analysisPrompt = `You are analyzing responses from multiple AI models to the same prompt. Please identify any inconsistencies or disagreements between the responses.

Original prompt: "${prompt}"

Responses:
${successfulResults.map((r, i) => `
Model ${i + 1} (${r.model}):
${r.text}
`).join('\n---\n')}

Please provide a brief summary of:
1. Any significant inconsistencies or disagreements between the responses
2. If the responses are consistent, confirm that they agree

Keep your analysis concise and focused on meaningful differences.`;

      try {
        const analysis = await callModel(defaultModel, analysisPrompt);
        inconsistencyAnalysis = analysis.text;
      } catch (error) {
        console.error('Error analyzing inconsistencies:', error);
      }
    }

    res.json({
      results,
      inconsistencyAnalysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing query:', error);
    res.status(500).json({ error: error.message });
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
${results.map((r, i) => `
Model ${i + 1} (${r.model}):
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
