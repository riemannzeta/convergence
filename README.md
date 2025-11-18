# Convergence

A simple web application for comparing responses across multiple AI foundation models. Run queries simultaneously across different models and analyze inconsistencies in their responses.

## Features

- Submit prompts to multiple AI models simultaneously
- Support for Anthropic Claude, OpenAI GPT, and Google Gemini models
- View extended thinking for supported models (Claude 3.7 Sonnet, Claude 3.5 Sonnet, Gemini models)
- Automatic inconsistency detection using your default model
- Generate detailed critiques comparing model responses
- Clean, collapsible UI for managing multiple query rounds
- Runs entirely locally on your Mac Silicon machine

## Supported Models

### Anthropic Claude
- Claude 3.7 Sonnet (with extended thinking)
- Claude 3.5 Sonnet (with extended thinking)
- Claude 3 Opus

### OpenAI
- GPT-4
- GPT-4 Turbo
- GPT-3.5 Turbo
- o1
- o1-mini

### Google Gemini
- Gemini 2.0 Flash (Experimental) (with thinking)
- Gemini 1.5 Pro (with thinking)
- Gemini 1.5 Flash (with thinking)
- Gemini 1.5 Flash-8B (with thinking)

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- API keys for the services you want to use:
  - [Anthropic API key](https://console.anthropic.com/)
  - [OpenAI API key](https://platform.openai.com/api-keys)
  - [Google API key](https://aistudio.google.com/app/apikey)

## Installation

1. Clone or download this repository:
```bash
cd convergence
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file by copying the example:
```bash
cp .env.example .env
```

4. Edit the `.env` file and add your API keys:
```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
PORT=3000
```

You only need to provide keys for the services you want to use. If you only have an Anthropic key, you'll only see Anthropic models in the UI.

## Usage

1. Start the server:
```bash
npm start
```

2. Open your web browser and navigate to:
```
http://localhost:3000
```

3. Using the app:
   - Enter your prompt in the text area
   - Select one or more models to query
   - Choose a default model for analysis (this model will analyze inconsistencies)
   - Click "Submit Query"
   - View responses from each model (including thinking for supported models)
   - Review the automatic inconsistency analysis
   - Optionally click "Generate Detailed Critique" for a deeper comparison
   - Submit new queries - previous rounds will automatically collapse

## How It Works

### Query Flow
1. You submit a prompt and select multiple models
2. The app queries all selected models in parallel
3. Responses are displayed side-by-side
4. Your default model analyzes all responses for inconsistencies
5. You can optionally request a detailed critique

### Inconsistency Detection
The app uses your selected default model to:
- Compare responses from all models
- Identify significant disagreements or inconsistencies
- Confirm when responses are consistent
- Provide a summary of key differences

### Detailed Critique
When you click "Generate Detailed Critique", the default model will:
- Point out specific inconsistencies between models
- Explain which approach might be more accurate
- Highlight areas where models agreed
- Suggest which response(s) might be most reliable

## Architecture

### Backend (server.js)
- Express.js server handling API requests
- Secure API key management via environment variables
- Support for multiple AI providers (Anthropic, OpenAI, Google)
- Parallel query execution for better performance
- Inconsistency analysis and critique generation

### Frontend (public/)
- Pure vanilla JavaScript (no framework dependencies)
- Responsive design optimized for Mac displays
- Real-time updates as responses arrive
- Collapsible round management for clean UI
- XSS protection via proper HTML escaping

## Security Notes

- API keys are stored in `.env` and never exposed to the frontend
- All API calls are proxied through the backend server
- The `.env` file is gitignored to prevent accidental commits
- HTML content is properly escaped to prevent XSS attacks

## Customization

### Adding New Models
Edit `server.js` and add new model configurations to the `MODELS` object:

```javascript
'your-model-key': {
  provider: 'anthropic', // or 'openai' or 'google'
  displayName: 'Your Model Name',
  modelId: 'api-model-id',
  supportsThinking: false
}
```

### Changing Styles
Edit `public/style.css` to customize the appearance. The CSS uses CSS variables for easy theming:

```css
:root {
    --primary-color: #6366f1;
    --background: #0f172a;
    /* ... more variables */
}
```

### Adjusting Token Limits
In `server.js`, modify the `max_tokens` parameter in the API calls:

```javascript
max_tokens: 4096, // Adjust as needed
```

## Troubleshooting

### Models not appearing
- Check that your API keys are correctly set in `.env`
- Restart the server after updating `.env`
- Check the console for error messages

### API errors
- Verify your API keys are valid and have sufficient credits
- Check that you have access to the models you're trying to use
- Review the browser console and server logs for detailed error messages

### Server won't start
- Make sure port 3000 is not already in use
- Try changing the PORT in `.env`
- Ensure all dependencies are installed (`npm install`)

## Development

The app uses ES modules (type: "module" in package.json), so all imports use the `import` syntax.

To modify the app:
1. Edit the relevant files
2. Restart the server to see backend changes
3. Refresh the browser to see frontend changes

## License

MIT

## Contributing

Feel free to submit issues or pull requests for improvements!
