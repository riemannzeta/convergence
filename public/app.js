const API_BASE = 'http://localhost:3000';

let availableModels = {};
let currentRound = 0;
let roundsData = [];

// Initialize the app
async function init() {
    await loadModels();
    setupEventListeners();
}

// Load available models from the server
async function loadModels() {
    try {
        const response = await fetch(`${API_BASE}/api/models`);
        availableModels = await response.json();

        const modelSelection = document.getElementById('model-selection');
        const defaultModelSelect = document.getElementById('default-model');

        if (Object.keys(availableModels).length === 0) {
            modelSelection.innerHTML = '<p class="error-message">No API keys configured. Please check your .env file.</p>';
            return;
        }

        // Populate model checkboxes
        modelSelection.innerHTML = '';
        for (const [key, config] of Object.entries(availableModels)) {
            const checkboxContainer = document.createElement('div');
            checkboxContainer.className = 'model-checkbox';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `model-${key}`;
            checkbox.value = key;
            checkbox.checked = true; // Check all models by default
            checkbox.addEventListener('change', updateSubmitButton);

            const label = document.createElement('label');
            label.htmlFor = `model-${key}`;
            label.textContent = config.displayName;

            checkboxContainer.appendChild(checkbox);
            checkboxContainer.appendChild(label);
            modelSelection.appendChild(checkboxContainer);
        }

        // Populate default model dropdown
        defaultModelSelect.innerHTML = '<option value="">Select default model...</option>';
        for (const [key, config] of Object.entries(availableModels)) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = config.displayName;
            defaultModelSelect.appendChild(option);
        }

        // Set first model as default
        const firstModelKey = Object.keys(availableModels)[0];
        if (firstModelKey) {
            defaultModelSelect.value = firstModelKey;
        }
    } catch (error) {
        console.error('Error loading models:', error);
        document.getElementById('model-selection').innerHTML =
            '<p class="error-message">Error loading models. Is the server running?</p>';
    }
}

// Setup event listeners
function setupEventListeners() {
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.addEventListener('click', handleSubmit);

    const promptInput = document.getElementById('prompt');
    promptInput.addEventListener('input', updateSubmitButton);

    const defaultModelSelect = document.getElementById('default-model');
    defaultModelSelect.addEventListener('change', updateSubmitButton);
}

// Update submit button state
function updateSubmitButton() {
    const prompt = document.getElementById('prompt').value.trim();
    const selectedModels = getSelectedModels();
    const defaultModel = document.getElementById('default-model').value;
    const submitBtn = document.getElementById('submit-btn');

    submitBtn.disabled = !prompt || selectedModels.length === 0 || !defaultModel;
}

// Get selected models
function getSelectedModels() {
    const checkboxes = document.querySelectorAll('#model-selection input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// Handle form submission
async function handleSubmit() {
    const prompt = document.getElementById('prompt').value.trim();
    const selectedModels = getSelectedModels();
    const defaultModel = document.getElementById('default-model').value;

    if (!prompt || selectedModels.length === 0 || !defaultModel) {
        return;
    }

    await submitQuery(prompt, selectedModels, defaultModel);
}

// Submit query (shared by main submit and resubmit)
async function submitQuery(prompt, selectedModels, defaultModel, previousRoundContext = null) {
    // Collapse previous rounds
    collapsePreviousRounds();

    // Create new round
    currentRound++;
    const roundData = {
        round: currentRound,
        prompt: prompt,
        models: selectedModels,
        defaultModel: defaultModel,
        results: [],
        inconsistencyAnalysis: null,
        agreementLevel: null,
        previousRoundContext: previousRoundContext
    };
    roundsData.push(roundData);

    // Create round UI with placeholder cards
    const roundDiv = createRoundUIWithPlaceholders(roundData);
    document.getElementById('rounds-container').appendChild(roundDiv);

    // Scroll to new round
    roundDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Disable submit button during processing
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
        // Submit query and handle streaming response
        const response = await fetch(`${API_BASE}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                models: selectedModels,
                defaultModel: defaultModel,
                previousRoundContext: previousRoundContext
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            // Decode the chunk and add it to the buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the incomplete line in the buffer

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const message = JSON.parse(line);
                        handleStreamMessage(message, roundDiv, roundData);
                    } catch (error) {
                        console.error('Error parsing stream message:', error, line);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error submitting query:', error);
        showError(roundDiv.querySelector('.round-content'), 'Error processing query. Please check the console for details.');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// Handle streaming message
function handleStreamMessage(message, roundDiv, roundData) {
    if (message.type === 'generated_prompt') {
        // Display the generated prompt for the specific model
        const { modelKey, prompt } = message.data;
        displayGeneratedPrompt(roundDiv, modelKey, prompt);
    } else if (message.type === 'result') {
        // Update the placeholder card for this model
        const result = message.data;
        roundData.results.push(result);
        updateResponseCard(roundDiv, result);
    } else if (message.type === 'analysis_start') {
        // Initialize analysis section
        roundData.inconsistencyAnalysis = '';
        roundData.agreementLevel = 'yellow'; // Default
        addInconsistencyAnalysis(roundDiv, roundData);
    } else if (message.type === 'analysis_chunk') {
        // Append chunk to analysis
        const chunk = message.data.chunk;
        roundData.inconsistencyAnalysis += chunk;
        updateInconsistencyAnalysis(roundDiv, roundData);
    } else if (message.type === 'analysis_agreement') {
        // Update agreement level color
        roundData.agreementLevel = message.data.agreementLevel;
        updateAnalysisColor(roundDiv, roundData);
    } else if (message.type === 'analysis') {
        // Legacy/Final analysis update (optional, but good for fallback)
        roundData.inconsistencyAnalysis = message.data.inconsistencyAnalysis;
        roundData.agreementLevel = message.data.agreementLevel;
        updateInconsistencyAnalysis(roundDiv, roundData);
        updateAnalysisColor(roundDiv, roundData);
    } else if (message.type === 'error') {
        console.error('Stream error:', message.data.error);
        showError(roundDiv.querySelector('.round-content'), message.data.error);
    }
}

// Display generated prompt in the card
function displayGeneratedPrompt(roundDiv, modelKey, prompt) {
    const card = roundDiv.querySelector(`#response-card-${modelKey}`);
    if (!card) return;

    // Check if prompt container already exists
    let promptContainer = card.querySelector('.generated-prompt-container');
    if (!promptContainer) {
        promptContainer = document.createElement('div');
        promptContainer.className = 'generated-prompt-container';
        promptContainer.style.marginBottom = '15px';
        promptContainer.style.padding = '10px';
        promptContainer.style.background = 'var(--surface-light)';
        promptContainer.style.borderRadius = '6px';
        promptContainer.style.borderLeft = '3px solid var(--primary-color)';

        const label = document.createElement('div');
        label.textContent = 'Follow-up Prompt:';
        label.style.fontWeight = 'bold';
        label.style.fontSize = '0.85rem';
        label.style.color = 'var(--text-secondary)';
        label.style.marginBottom = '5px';

        const text = document.createElement('div');
        text.className = 'generated-prompt-text';
        text.style.fontSize = '0.9rem';
        text.style.fontStyle = 'italic';

        promptContainer.appendChild(label);
        promptContainer.appendChild(text);

        // Insert after header
        const header = card.querySelector('.response-header');
        if (header && header.nextSibling) {
            card.insertBefore(promptContainer, header.nextSibling);
        } else {
            card.appendChild(promptContainer);
        }
    }

    promptContainer.querySelector('.generated-prompt-text').textContent = prompt;
}

// Create round UI with placeholder cards
function createRoundUIWithPlaceholders(roundData) {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'round';
    roundDiv.id = `round-${roundData.round}`;

    const header = document.createElement('div');
    header.className = 'round-header';
    header.innerHTML = `
        <h2>Round ${roundData.round}</h2>
        <button class="btn btn-secondary toggle-btn" onclick="toggleRound(${roundData.round})">Collapse</button>
    `;

    const content = document.createElement('div');
    content.className = 'round-content';

    // Only show global prompt if it's Round 1 (no previous context)
    if (!roundData.previousRoundContext) {
        const originalPromptDiv = document.createElement('div');
        originalPromptDiv.className = 'original-prompt';
        originalPromptDiv.innerHTML = `
            <div class="original-prompt-label">Prompt</div>
            <div class="original-prompt-text">${escapeHtml(roundData.prompt)}</div>
        `;
        content.appendChild(originalPromptDiv);
    }

    // Create placeholder response cards
    const responsesGrid = document.createElement('div');
    responsesGrid.className = 'responses-grid';
    responsesGrid.id = `responses-grid-${roundData.round}`;

    for (const modelKey of roundData.models) {
        const modelConfig = availableModels[modelKey];
        const placeholderCard = createPlaceholderCard(modelKey, modelConfig ? modelConfig.displayName : modelKey);
        responsesGrid.appendChild(placeholderCard);
    }

    content.appendChild(responsesGrid);

    roundDiv.appendChild(header);
    roundDiv.appendChild(content);

    return roundDiv;
}

// Create placeholder response card
function createPlaceholderCard(modelKey, displayName) {
    const card = document.createElement('div');
    card.className = 'response-card loading';
    card.id = `response-card-${modelKey}`;

    const header = document.createElement('div');
    header.className = 'response-header';

    const modelName = document.createElement('div');
    modelName.className = 'model-name';
    modelName.textContent = displayName;

    const statusBadge = document.createElement('div');
    statusBadge.className = 'status-badge pending';
    statusBadge.textContent = 'Loading...';

    header.appendChild(modelName);
    header.appendChild(statusBadge);
    card.appendChild(header);

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.textContent = 'Waiting for response...';
    card.appendChild(loadingDiv);

    return card;
}

// Update response card with actual result
function updateResponseCard(roundDiv, result) {
    const card = roundDiv.querySelector(`#response-card-${result.modelKey}`);
    if (!card) return;

    // Preserve generated prompt if it exists
    const generatedPrompt = card.querySelector('.generated-prompt-container');

    // Clear loading state
    card.className = result.success ? 'response-card' : 'response-card error';
    card.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'response-header';

    const modelName = document.createElement('div');
    modelName.className = 'model-name';
    modelName.textContent = result.model || availableModels[result.modelKey]?.displayName || result.modelKey;

    const statusBadge = document.createElement('div');
    statusBadge.className = result.success ? 'status-badge success' : 'status-badge error';
    statusBadge.textContent = result.success ? 'Success' : 'Error';

    header.appendChild(modelName);
    header.appendChild(statusBadge);
    card.appendChild(header);

    // Re-attach generated prompt
    if (generatedPrompt) {
        card.appendChild(generatedPrompt);
    }

    if (result.success) {
        // Add thinking if available
        if (result.thinking) {
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'thinking-section';
            thinkingDiv.innerHTML = `
                <div class="thinking-header">Thinking Process</div>
                <div class="thinking-content">${renderMarkdown(result.thinking)}</div>
            `;
            card.appendChild(thinkingDiv);
        }

        // Add response text
        const responseText = document.createElement('div');
        responseText.className = 'response-text';
        responseText.innerHTML = renderMarkdown(result.text);
        card.appendChild(responseText);

        // Trigger MathJax
        if (window.MathJax) {
            window.MathJax.typesetPromise([card]);
        }
    } else {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = result.error;
        card.appendChild(errorMessage);
    }
}

// Add inconsistency analysis to round
function addInconsistencyAnalysis(roundDiv, roundData) {
    const content = roundDiv.querySelector('.round-content');

    // Check if already exists
    if (content.querySelector('.analysis-section')) return;

    const analysisDiv = document.createElement('div');
    // Add color class based on agreement level
    const colorClass = roundData.agreementLevel || 'yellow';
    analysisDiv.className = `analysis-section ${colorClass}`;

    // Create checkboxes for models
    let checkboxesHTML = '<div class="model-selection-resubmit" style="margin: 15px 0; display: flex; gap: 10px; flex-wrap: wrap;">';
    roundData.models.forEach(modelKey => {
        const modelName = availableModels[modelKey]?.displayName || modelKey;
        checkboxesHTML += `
            <div class="model-checkbox" style="padding: 8px;">
                <input type="checkbox" id="resubmit-model-${roundData.round}-${modelKey}" value="${modelKey}" checked>
                <label for="resubmit-model-${roundData.round}-${modelKey}">${modelName}</label>
            </div>
        `;
    });
    checkboxesHTML += '</div>';

    analysisDiv.innerHTML = `
        <div class="analysis-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Inconsistency Analysis</span>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.8rem;" onclick="toggleEditAnalysis(${roundData.round})">Edit</button>
        </div>
        <div id="analysis-view-${roundData.round}" class="analysis-text">
            ${roundData.inconsistencyAnalysis ? renderMarkdown(roundData.inconsistencyAnalysis) : '<div class="loading">Waiting for analysis</div>'}
        </div>
        <div id="analysis-edit-${roundData.round}" style="display: none;">
            <textarea id="analysis-textarea-${roundData.round}" rows="10" style="width: 100%; margin-bottom: 10px;">${roundData.inconsistencyAnalysis || ''}</textarea>
        </div>
        
        <div style="margin-top: 15px;">
            <details>
                <summary style="cursor: pointer; color: var(--primary-color); font-weight: 600; margin-bottom: 10px;">Additional Instructions (Optional)</summary>
                <textarea id="additional-instructions-${roundData.round}" rows="3" placeholder="Enter any specific instructions or questions to be included in the follow-up prompts..." style="width: 100%; margin-top: 5px;"></textarea>
            </details>
        </div>

        ${checkboxesHTML}
        <div class="action-buttons">
            <button class="btn btn-primary" onclick="handleResubmit(${roundData.round})" title="Resubmit the inconsistency analysis to each model for further analysis">Resubmit</button>
        </div>
    `;
    content.appendChild(analysisDiv);

    // Trigger MathJax
    if (window.MathJax) {
        window.MathJax.typesetPromise([analysisDiv]);
    }
}

// Update inconsistency analysis text
function updateInconsistencyAnalysis(roundDiv, roundData) {
    const viewDiv = roundDiv.querySelector(`#analysis-view-${roundData.round}`);
    const textarea = roundDiv.querySelector(`#analysis-textarea-${roundData.round}`);

    if (viewDiv) {
        viewDiv.innerHTML = renderMarkdown(roundData.inconsistencyAnalysis);
        if (window.MathJax) window.MathJax.typesetPromise([viewDiv]);
    }

    if (textarea) {
        textarea.value = roundData.inconsistencyAnalysis;
    }

    // If analysis section doesn't exist yet (e.g. receiving chunk before start message processed?), create it
    if (!viewDiv) {
        addInconsistencyAnalysis(roundDiv, roundData);
    }
}

// Update analysis color
function updateAnalysisColor(roundDiv, roundData) {
    const analysisDiv = roundDiv.querySelector('.analysis-section');
    if (analysisDiv) {
        // Remove old color classes
        analysisDiv.classList.remove('red', 'yellow', 'green');
        // Add new color class
        if (roundData.agreementLevel) {
            analysisDiv.classList.add(roundData.agreementLevel);
        }
    }
}

// Toggle edit mode for analysis
function toggleEditAnalysis(roundNumber) {
    const viewDiv = document.getElementById(`analysis-view-${roundNumber}`);
    const editDiv = document.getElementById(`analysis-edit-${roundNumber}`);

    if (viewDiv.style.display === 'none') {
        viewDiv.style.display = 'block';
        editDiv.style.display = 'none';
        // Update the data with edited text
        const textarea = document.getElementById(`analysis-textarea-${roundNumber}`);
        const roundData = roundsData.find(r => r.round === roundNumber);
        if (roundData) {
            roundData.inconsistencyAnalysis = textarea.value;
            viewDiv.innerHTML = renderMarkdown(textarea.value);
            if (window.MathJax) window.MathJax.typesetPromise([viewDiv]);
        }
    } else {
        viewDiv.style.display = 'none';
        editDiv.style.display = 'block';
    }
}

// Handle resubmit
async function handleResubmit(roundNumber) {
    const roundData = roundsData.find(r => r.round === roundNumber);
    if (!roundData) return;

    // Get current analysis text (in case it was edited)
    const textarea = document.getElementById(`analysis-textarea-${roundNumber}`);
    const currentAnalysis = textarea ? textarea.value : roundData.inconsistencyAnalysis;

    // Get additional instructions
    const instructionsTextarea = document.getElementById(`additional-instructions-${roundNumber}`);
    const additionalInstructions = instructionsTextarea ? instructionsTextarea.value.trim() : '';

    // Get selected models for resubmit
    const selectedModels = [];
    roundData.models.forEach(modelKey => {
        const checkbox = document.getElementById(`resubmit-model-${roundNumber}-${modelKey}`);
        if (checkbox && checkbox.checked) {
            selectedModels.push(modelKey);
        }
    });

    if (selectedModels.length === 0) {
        alert('Please select at least one model to resubmit to.');
        return;
    }

    // Prepare context for Round 2
    const previousRoundContext = {
        originalPrompt: roundData.prompt,
        previousResponses: roundData.results.filter(r => r.success),
        inconsistencyAnalysis: currentAnalysis,
        additionalInstructions: additionalInstructions
    };

    // Submit the query with context
    // We use the original prompt as the base, but the server will use the context to generate new prompts
    await submitQuery(roundData.prompt, selectedModels, roundData.defaultModel, previousRoundContext);
}

// Collapse previous rounds
function collapsePreviousRounds() {
    const rounds = document.querySelectorAll('.round:not(.collapsed)');
    rounds.forEach(round => {
        round.classList.add('collapsed');
        const toggleBtn = round.querySelector('.toggle-btn');
        if (toggleBtn) {
            toggleBtn.textContent = 'Expand';
        }
    });
}

// Toggle round collapse
function toggleRound(roundNumber) {
    const roundDiv = document.getElementById(`round-${roundNumber}`);
    const toggleBtn = roundDiv.querySelector('.toggle-btn');

    if (roundDiv.classList.contains('collapsed')) {
        roundDiv.classList.remove('collapsed');
        toggleBtn.textContent = 'Collapse';
    } else {
        roundDiv.classList.add('collapsed');
        toggleBtn.textContent = 'Expand';
    }
}

// Show error message
function showError(container, message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Render markdown to HTML with MathJax protection
function renderMarkdown(text) {
    if (typeof marked === 'undefined') {
        return escapeHtml(text);
    }

    // Protect math blocks
    const mathBlocks = [];
    const protectedText = text.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\(.*?\\\)|(?<!\\)\$[^$]*?\$)/g, (match) => {
        mathBlocks.push(match);
        return `MATHBLOCK${mathBlocks.length - 1}PLACEHOLDER`;
    });

    // Render markdown
    let html = marked.parse(protectedText);

    // Restore math blocks
    html = html.replace(/MATHBLOCK(\d+)PLACEHOLDER/g, (match, index) => {
        return mathBlocks[parseInt(index)];
    });

    return html;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


