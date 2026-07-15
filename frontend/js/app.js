document.addEventListener('DOMContentLoaded', () => {
    const uploadBox = document.getElementById('uploadBox');
    const imageInput = document.getElementById('imageInput');
    const uploadContent = document.querySelector('.upload-content');
    const imagePreview = document.getElementById('imagePreview');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingText = document.getElementById('loadingText');
    const resultsSection = document.getElementById('resultsSection');
    const resetBtn = document.getElementById('resetBtn');

    let selectedFile = null;

    uploadBox.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadBox.style.borderColor = 'var(--accent-green)';
    });

    uploadBox.addEventListener('dragleave', () => {
        uploadBox.style.borderColor = 'var(--border-color)';
    });

    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadBox.style.borderColor = 'var(--border-color)';
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            imagePreview.classList.remove('hidden');
            uploadContent.classList.add('hidden');
            analyzeBtn.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    analyzeBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        // UI State
        analyzeBtn.classList.add('hidden');
        loadingIndicator.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        
        try {
            loadingText.innerText = 'Analyzing image with AI...';
            const formData = new FormData();
            formData.append('file', selectedFile);

            const predictRes = await fetch('/api/predict', {
                method: 'POST',
                body: formData
            });

            if (!predictRes.ok) {
                const error = await predictRes.json();
                throw new Error(error.detail || 'Prediction failed');
            }

            const predictData = await predictRes.json();
            
            let rawName = predictData.disease_name;
            let cropName = "Unknown";
            let displayName = rawName;
            
            if (rawName.includes("___")) {
                let parts = rawName.split("___");
                cropName = parts[0].replace(/_/g, ' ');
                displayName = parts[1].replace(/_/g, ' ');
                if (displayName.toLowerCase() === 'healthy') {
                    displayName = "Healthy (No Disease)";
                }
            } else {
                displayName = rawName.replace(/_/g, ' ');
            }
            
            document.getElementById('cropBadge').innerText = cropName;
            document.getElementById('diseaseName').innerText = displayName;
            
            const confidencePercent = (predictData.confidence * 100).toFixed(1);
            document.getElementById('confidenceLevel').innerText = confidencePercent + '%';
            
            setTimeout(() => {
                document.getElementById('confidenceBar').style.width = confidencePercent + '%';
                
                if (predictData.confidence > 0.8) {
                    document.getElementById('confidenceBar').style.background = 'linear-gradient(90deg, #10b981, #34d399)';
                } else if (predictData.confidence > 0.5) {
                    document.getElementById('confidenceBar').style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
                } else {
                    document.getElementById('confidenceBar').style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
                }
            }, 100);

            if (predictData.is_low_confidence) {
                document.getElementById('lowConfidenceWarning').classList.remove('hidden');
            } else {
                document.getElementById('lowConfidenceWarning').classList.add('hidden');
            }

            await fetchExplanation(displayName);

            loadingIndicator.classList.add('hidden');
            resultsSection.classList.remove('hidden');

        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred: ' + error.message);
            loadingIndicator.classList.add('hidden');
            analyzeBtn.classList.remove('hidden');
        }
    });
    
    async function fetchExplanation(diseaseName) {
        loadingText.innerText = 'Consulting AI Expert...';
        document.getElementById('aiErrorState').classList.add('hidden');
        document.getElementById('hindiExplanation').innerHTML = '<div class="loading"><div class="spinner"></div><p>Translating...</p></div>';
        
        const selectedLanguage = document.getElementById('languageSelect').value;
        
        try {
            const explainRes = await fetch('/api/explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    disease_name: diseaseName,
                    language: selectedLanguage
                })
            });

            if (!explainRes.ok) {
                const errorData = await explainRes.json().catch(() => ({}));
                throw new Error(errorData.detail || 'Failed to fetch explanation');
            }

            const explainData = await explainRes.json();
            document.getElementById('hindiExplanation').innerHTML = marked.parse(explainData.explanation);
        } catch (aiError) {
            console.error('AI Error:', aiError);
            document.getElementById('hindiExplanation').innerHTML = '';
            const errState = document.getElementById('aiErrorState');
            errState.classList.remove('hidden');
            errState.innerHTML = `
                <div class="error-banner">
                    <span class="error-icon">⚠️</span>
                    <div>
                        <h4 style="margin: 0; color: #b91c1c;">Explanation Unavailable</h4>
                        <p style="margin: 0.25rem 0 0 0; font-size: 0.875rem;">Error: ${aiError.message}</p>
                    </div>
                </div>
            `;
        }
    }
    
    document.getElementById('languageSelect').addEventListener('change', () => {
        const diseaseName = document.getElementById('diseaseName').innerText;
        if (diseaseName && diseaseName !== '-') {
            fetchExplanation(diseaseName);
        }
    });

    resetBtn.addEventListener('click', () => {
        selectedFile = null;
        imageInput.value = '';
        imagePreview.src = '';
        imagePreview.classList.add('hidden');
        uploadContent.classList.remove('hidden');
        resultsSection.classList.add('hidden');
        analyzeBtn.classList.add('hidden');
        document.getElementById('confidenceBar').style.width = '0%';
        document.getElementById('lowConfidenceWarning').classList.add('hidden');
    });
});
