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
async function submitQuery(prompt, selectedModels, defaultModel) {
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
        critique: null
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
                defaultModel: defaultModel
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
    if (message.type === 'result') {
        // Update the placeholder card for this model
        const result = message.data;
        roundData.results.push(result);
        updateResponseCard(roundDiv, result);
    } else if (message.type === 'analysis') {
        // Add inconsistency analysis
        roundData.inconsistencyAnalysis = message.data.inconsistencyAnalysis;
        addInconsistencyAnalysis(roundDiv, roundData);
    } else if (message.type === 'error') {
        console.error('Stream error:', message.data.error);
        showError(roundDiv.querySelector('.round-content'), message.data.error);
    }
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

    const originalPromptDiv = document.createElement('div');
    originalPromptDiv.className = 'original-prompt';
    originalPromptDiv.innerHTML = `
        <div class="original-prompt-label">Prompt</div>
        <div class="original-prompt-text">${escapeHtml(roundData.prompt)}</div>
    `;

    content.appendChild(originalPromptDiv);

    // Create placeholder response cards
    const responsesGrid = document.createElement('div');
    responsesGrid.className = 'responses-grid';
    responsesGrid.id = `responses-grid-${roundData.round}`;

    for (const modelKey of roundData.models) {
        const modelConfig = availableModels[modelKey];
        const placeholderCard = createPlaceholderCard(modelKey, modelConfig.displayName);
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
    const card = document.getElementById(`response-card-${result.modelKey}`);
    if (!card) return;

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

    if (roundData.inconsistencyAnalysis) {
        const analysisDiv = document.createElement('div');
        analysisDiv.className = 'analysis-section';
        
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
            <div class="analysis-header">Inconsistency Analysis</div>
            <div class="analysis-text" style="white-space: pre-wrap; font-family: monospace; background: var(--surface-light); padding: 15px; border-radius: 6px;">${escapeHtml(roundData.inconsistencyAnalysis)}</div>
            ${checkboxesHTML}
            <div class="action-buttons">
                <button class="btn btn-primary" onclick="handleResubmit(${roundData.round})">Resubmit Analysis</button>
                <button class="btn btn-secondary" onclick="generateCritique(${roundData.round})">Generate Detailed Critique</button>
            </div>
        `;
        content.appendChild(analysisDiv);
    }
}

// Handle resubmit
async function handleResubmit(roundNumber) {
    const roundData = roundsData.find(r => r.round === roundNumber);
    if (!roundData || !roundData.inconsistencyAnalysis) return;

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

    // Use the inconsistency analysis as the new prompt
    const newPrompt = roundData.inconsistencyAnalysis;
    
    // Submit the new query
    await submitQuery(newPrompt, selectedModels, roundData.defaultModel);
}

// Create round UI
function createRoundUI(roundData) {
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

    const originalPromptDiv = document.createElement('div');
    originalPromptDiv.className = 'original-prompt';
    originalPromptDiv.innerHTML = `
        <div class="original-prompt-label">Prompt</div>
        <div class="original-prompt-text">${escapeHtml(roundData.prompt)}</div>
    `;

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.textContent = 'Querying models';

    content.appendChild(originalPromptDiv);
    content.appendChild(loadingDiv);

    roundDiv.appendChild(header);
    roundDiv.appendChild(content);

    return roundDiv;
}

// Update round with results
function updateRoundResults(roundDiv, roundData) {
    const content = roundDiv.querySelector('.round-content');

    // Remove loading message
    const loading = content.querySelector('.loading');
    if (loading) loading.remove();

    // Add responses
    const responsesGrid = document.createElement('div');
    responsesGrid.className = 'responses-grid';

    for (const result of roundData.results) {
        const responseCard = createResponseCard(result);
        responsesGrid.appendChild(responseCard);
    }

    content.appendChild(responsesGrid);

    // Add inconsistency analysis
    if (roundData.inconsistencyAnalysis) {
        const analysisDiv = document.createElement('div');
        analysisDiv.className = 'analysis-section';
        analysisDiv.innerHTML = `
            <div class="analysis-header">Inconsistency Analysis</div>
            <div class="analysis-text">${renderMarkdown(roundData.inconsistencyAnalysis)}</div>
        `;
        content.appendChild(analysisDiv);

        // Add action buttons
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';
        actionButtons.innerHTML = `
            <button class="btn btn-primary" onclick="generateCritique(${roundData.round})">Generate Detailed Critique</button>
        `;
        content.appendChild(actionButtons);
    }
}

// Create response card
function createResponseCard(result) {
    const card = document.createElement('div');
    card.className = result.success ? 'response-card' : 'response-card error';

    const header = document.createElement('div');
    header.className = 'response-header';

    const modelName = document.createElement('div');
    modelName.className = 'model-name';
    modelName.textContent = result.model || result.modelKey;

    const statusBadge = document.createElement('div');
    statusBadge.className = result.success ? 'status-badge success' : 'status-badge error';
    statusBadge.textContent = result.success ? 'Success' : 'Error';

    header.appendChild(modelName);
    header.appendChild(statusBadge);
    card.appendChild(header);

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
    } else {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = result.error;
        card.appendChild(errorMessage);
    }

    return card;
}

// Generate critique
async function generateCritique(roundNumber) {
    const roundData = roundsData.find(r => r.round === roundNumber);
    if (!roundData) return;

    const roundDiv = document.getElementById(`round-${roundNumber}`);
    const content = roundDiv.querySelector('.round-content');

    // Remove action buttons
    const actionButtons = content.querySelector('.action-buttons');
    if (actionButtons) actionButtons.remove();

    // Show loading
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.textContent = 'Generating detailed critique';
    content.appendChild(loadingDiv);

    try {
        const response = await fetch(`${API_BASE}/api/critique`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                originalPrompt: roundData.prompt,
                results: roundData.results.filter(r => r.success),
                defaultModel: roundData.defaultModel
            })
        });

        const data = await response.json();
        roundData.critique = data.critique;

        // Remove loading
        loadingDiv.remove();

        // Add critique section
        const critiqueDiv = document.createElement('div');
        critiqueDiv.className = 'critique-section';

        let critiqueHTML = `<div class="critique-header">Detailed Critique</div>`;

        if (data.thinking) {
            critiqueHTML += `
                <div class="thinking-section">
                    <div class="thinking-header">Thinking Process</div>
                    <div class="thinking-content">${renderMarkdown(data.thinking)}</div>
                </div>
            `;
        }

        critiqueHTML += `<div class="analysis-text">${renderMarkdown(data.critique)}</div>`;

        critiqueDiv.innerHTML = critiqueHTML;
        content.appendChild(critiqueDiv);
        
        // Trigger MathJax
        if (window.MathJax) {
            window.MathJax.typesetPromise([critiqueDiv]);
        }
    } catch (error) {
        console.error('Error generating critique:', error);
        loadingDiv.remove();
        showError(content, 'Error generating critique. Please check the console for details.');
    }
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

// Render markdown to HTML
function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    }
    // Fallback if marked is not loaded
    return escapeHtml(text);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
