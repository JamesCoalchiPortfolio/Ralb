document.addEventListener('DOMContentLoaded', () => {
    const audioFileInput = document.getElementById('audioFile');
    const audioLabelInput = document.getElementById('audioLabel');
    const addSoundBtn = document.getElementById('addSoundBtn');
    const soundQueueList = document.getElementById('soundQueueList');
    const generateBtn = document.getElementById('generateBtn');
    const combinedAudioPlayer = document.getElementById('combinedAudioPlayer');
    const downloadAudioLink = document.getElementById('downloadAudioLink');
    const wordMapOutput = document.getElementById('wordMapOutput');
    const fullLuaScriptOutput = document.getElementById('fullLuaScriptOutput'); // New element
    const resultsDiv = document.getElementById('results');
    const statusMessage = document.getElementById('statusMessage');
    const queueEmptyMessage = document.getElementById('queue-empty-message');


    let soundQueue = []; // Array of { id: number, file: File, label: string, audioBuffer?: AudioBuffer }
    let nextId = 0;
    const DELAY_SECONDS = 0.5; // Delay between concatenated sounds

    let audioContext;

    function getAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioContext;
    }

    addSoundBtn.addEventListener('click', () => {
        const file = audioFileInput.files[0];
        let label = audioLabelInput.value.trim().toUpperCase();

        if (!file || !label) {
            statusMessage.textContent = 'Please select an audio file and enter a label.';
            statusMessage.style.color = 'red';
            return;
        }
        if (!/^[A-Z_][A-Z0-9_]*$/.test(label)) {
            statusMessage.textContent = 'Label must be uppercase letters, numbers, or underscores, and not start with a number (e.g., MY_SOUND, JUMP_1).';
            statusMessage.style.color = 'red';
            return;
        }
        if (soundQueue.some(item => item.label === label)) {
            statusMessage.textContent = `Label "${label}" already exists. Please use a unique label.`;
            statusMessage.style.color = 'red';
            return;
        }

        const soundItem = { id: nextId++, file, label };
        soundQueue.push(soundItem);
        renderQueue();
        audioFileInput.value = '';
        audioLabelInput.value = '';
        statusMessage.textContent = `Added "${label}".`;
        statusMessage.style.color = 'green';
        setTimeout(() => { statusMessage.textContent = ''; }, 3000);
    });

    function renderQueue() {
        soundQueueList.innerHTML = '';
        if (soundQueue.length === 0) {
            queueEmptyMessage.style.display = 'block';
            resultsDiv.style.display = 'none';
        } else {
            queueEmptyMessage.style.display = 'none';
            soundQueue.forEach(item => {
                const li = document.createElement('li');
                li.textContent = `${item.label} (${item.file.name}, ${item.file.type})`;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.onclick = () => {
                    soundQueue = soundQueue.filter(i => i.id !== item.id);
                    renderQueue();
                    statusMessage.textContent = `Removed "${item.label}".`;
                    statusMessage.style.color = 'orange';
                    setTimeout(() => { statusMessage.textContent = ''; }, 3000);
                };
                li.appendChild(removeBtn);
                soundQueueList.appendChild(li);
            });
        }
        generateBtn.disabled = soundQueue.length === 0;
    }

    generateBtn.addEventListener('click', async () => {
        if (soundQueue.length === 0) {
            alert('Please add sounds to the queue first.');
            return;
        }

        const originalButtonText = generateBtn.textContent;
        generateBtn.disabled = true;
        generateBtn.textContent = 'Processing...';
        statusMessage.textContent = 'Initializing...';
        statusMessage.style.color = '#555';
        resultsDiv.style.display = 'none';

        const actx = getAudioContext();
        let wordMapData = {};
        let totalDurationSeconds = 0;
        const decodedAudioItems = []; // Store {label, buffer} to maintain order

        try {
            statusMessage.textContent = 'Decoding audio files... (this may take a moment)';
            // 1. Read and Decode all files
            // Use a for...of loop to process files sequentially for better status updates (optional)
            // or stick with Promise.all for parallel decoding.
            const decodePromises = soundQueue.map(item => {
                return new Promise((resolve, reject) => {
                    if (item.audioBuffer) { // Already decoded
                        resolve({ label: item.label, buffer: item.audioBuffer, originalIndex: soundQueue.indexOf(item) });
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const decodedBuffer = await actx.decodeAudioData(e.target.result);
                            item.audioBuffer = decodedBuffer; // Cache for potential reuse
                            resolve({ label: item.label, buffer: decodedBuffer, originalIndex: soundQueue.indexOf(item) });
                        } catch (decodeError) {
                            console.error(`Error decoding ${item.file.name}:`, decodeError);
                            reject(`Error decoding ${item.file.name}: ${decodeError.message || decodeError}`);
                        }
                    };
                    reader.onerror = () => reject(`Error reading ${item.file.name}`);
                    reader.readAsArrayBuffer(item.file);
                });
            });

            const resolvedItems = await Promise.all(decodePromises);
            // Sort resolvedItems based on their original order in soundQueue
            resolvedItems.sort((a, b) => a.originalIndex - b.originalIndex);
            resolvedItems.forEach(item => decodedAudioItems.push({label: item.label, buffer: item.buffer}));


            statusMessage.textContent = 'Calculating durations and combining audio...';

            // 2. Calculate total duration and prepare for OfflineAudioContext
            decodedAudioItems.forEach((item, index) => {
                totalDurationSeconds += item.buffer.duration;
                if (index < decodedAudioItems.length - 1) {
                    totalDurationSeconds += DELAY_SECONDS;
                }
            });

            if (totalDurationSeconds <= 0) {
                throw new Error("Total duration is zero or invalid. Check audio files.");
            }
            
            const offlineCtxChannelCount = actx.destination.channelCount > 0 ? actx.destination.channelCount : 2;
            const offlineCtxSampleRate = actx.sampleRate;
            const offlineCtx = new OfflineAudioContext(
                offlineCtxChannelCount,
                Math.ceil(offlineCtxSampleRate * totalDurationSeconds),
                offlineCtxSampleRate
            );

            // 3. Schedule sounds in OfflineAudioContext
            let currentTime = 0;
            decodedAudioItems.forEach((item, index) => {
                const source = offlineCtx.createBufferSource();
                source.buffer = item.buffer;
                source.connect(offlineCtx.destination);
                source.start(currentTime);

                wordMapData[item.label] = {
                    startTime: parseFloat(currentTime.toFixed(3)),
                    endTime: parseFloat((currentTime + item.buffer.duration).toFixed(3))
                };

                currentTime += item.buffer.duration;
                if (index < decodedAudioItems.length - 1) {
                    currentTime += DELAY_SECONDS;
                }
            });

            // 4. Render the audio
            const finalCombinedBuffer = await offlineCtx.startRendering();

            // 5. Convert to WAV and generate WordMap + Full Lua Script
            statusMessage.textContent = 'Generating output files and script...';
            const wavBlob = audioBufferToWav(finalCombinedBuffer);
            const audioURL = URL.createObjectURL(wavBlob);

            combinedAudioPlayer.src = audioURL;
            downloadAudioLink.href = audioURL;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            downloadAudioLink.download = `combined_audio_${timestamp}.wav`;

            let wordMapLuaString = "local wordMap = {\n";
            for (const key in wordMapData) {
                wordMapLuaString += `\t${key} = {startTime = ${wordMapData[key].startTime}, endTime = ${wordMapData[key].endTime}},\n`;
            }
            wordMapLuaString += "}";
            wordMapOutput.value = wordMapLuaString;

            // --- Generate Full Lua Script ---
            // Helper to convert labels like "MY_LABEL" to "MyLabel" (PascalCase) and "myLabelButton" (camelCase for var)
            function processLabelForLua(label) {
                const parts = label.toLowerCase().split('_').filter(p => p.length > 0);
                const pascalCaseName = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
                const camelCaseVarBase = pascalCaseName.charAt(0).toLowerCase() + pascalCaseName.slice(1);
                return {
                    pascalCase: pascalCaseName || "Unnamed", // Fallback for empty/invalid label
                    camelCaseVar: (camelCaseVarBase || "unnamed") + "Button"
                };
            }
            
            const fullLuaScript = `--- Services ---
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")

-- IMPORTANT: This LocalScript expects:
-- 1. A 'Sound' object named "Sound" as its direct child.
--    You MUST upload the generated WAV file to this Sound object and set its SoundId..

local soundObject = script:FindFirstChild("Sound") -- You can change this depending on how your sound object is named

--- Initialization Check ---
if not soundObject then
    warn("[SoundScript] Sound object named 'Sound' not found as a child of this script. Please add it and set its SoundId.")
    return
end
if not soundObject:IsA("Sound") then
    warn("[SoundScript] The object named 'Sound' is not a Sound instance. Please ensure it's a Sound object.")
    return
end
if soundObject.SoundId == "" then
    warn("[SoundScript] The Sound object's SoundId is empty. Please upload the combined audio and set the SoundId.")
    -- You might want to return here or disable functionality if SoundId is crucial for preloading.
end

-- Preload the sound for smoother playback (recommended)
if not soundObject.IsLoaded and soundObject.SoundId ~= "" then
    print("[SoundScript] Sound '"..soundObject.Name.."' (SoundId: " .. soundObject.SoundId .. ") is not loaded. Attempting to preload...")
    local success, err = pcall(function()
        SoundService:PreloadAsync({soundObject})
    end)
    if success then
        print("[SoundScript] Sound preloaded successfully!")
    else
        warn("[SoundScript] Failed to preload sound: " .. tostring(err) .. ". Playback might be delayed or fail.")
        -- Fallback: Wait for .Loaded event if preload fails but SoundId is present
        if not soundObject.IsLoaded then
            print("[SoundScript] Waiting for sound to load via .Loaded event...")
            soundObject.Loaded:Wait()
            print("[SoundScript] Sound loaded via .Loaded:Wait().")
        end
    end
else
    if soundObject.IsLoaded then
        print("[SoundScript] Sound is already loaded.")
    end
end

-- WordMap generated by the website:
${wordMapLuaString}
-- End of WordMap

--- Playback Logic ---
local currentStopConnection = nil
local segmentEndTime = 0
local isStoppingSound = false -- Flag to prevent race conditions or re-entrant calls

local function playSegment(wordKey)
    -- wordKey is expected to be an uppercase string matching a key in wordMap
    local segment = wordMap[wordKey]

    if not segment then
        warn("[SoundScript] WordKey '" .. tostring(wordKey) .. "' not found in wordMap.")
        return
    end

    if isStoppingSound then return end -- Avoid issues if already in the process of stopping

    -- Stop any existing playback and disconnect previous Heartbeat
    if currentStopConnection then
        currentStopConnection:Disconnect()
        currentStopConnection = nil
    end
    soundObject:Stop() -- Ensures a clean start for the new segment

    print(string.format("[SoundScript] Playing '%s': %.3fs to %.3fs", wordKey, segment.startTime, segment.endTime))
    soundObject.TimePosition = segment.startTime
    segmentEndTime = segment.endTime -- Store for the Heartbeat check

    soundObject:Play()
    isStoppingSound = false -- Reset flag

    currentStopConnection = RunService.Heartbeat:Connect(function(deltaTime)
        if not soundObject.IsPlaying then
            if currentStopConnection then
                currentStopConnection:Disconnect()
                currentStopConnection = nil
            end
            return
        end

        -- Check if the sound has played past its intended segment end time
        if soundObject.TimePosition >= segmentEndTime then
            if not isStoppingSound then -- Check flag before attempting to stop
                isStoppingSound = true
                soundObject:Pause() -- Use Pause to stop precisely at the current TimePosition
                print(string.format("[SoundScript] Paused '%s' at TimePosition: %.3fs (Target: %.3fs)", wordKey, soundObject.TimePosition, segmentEndTime))
                if currentStopConnection then
                    currentStopConnection:Disconnect()
                    currentStopConnection = nil
                end
                -- Short delay to allow sound to actually pause before resetting flag
                task.wait(0.05) 
                isStoppingSound = false
            end
        end
    end)

    -- Fallback timer: Ensures the sound stops if Heartbeat misses or an issue occurs
    local segmentDuration = segment.endTime - segment.startTime
    task.delay(segmentDuration + 0.2, function() -- Buffer of 0.2 seconds
        if currentStopConnection and soundObject.IsPlaying then
            -- Only stop if it's genuinely overrunning and not already being handled
            if soundObject.TimePosition < segmentEndTime + 0.18 and not isStoppingSound then
                print(string.format("[SoundScript] Fallback timer stopping '%s' (overrun guard). Pos: %.3fs", wordKey, soundObject.TimePosition))
                isStoppingSound = true
                soundObject:Pause()
                if currentStopConnection then
                    currentStopConnection:Disconnect()
                    currentStopConnection = nil
                end
                task.wait(0.05)
                isStoppingSound = false
            end
        end
    end)
end

--- Add your interactions here (eg. text button)

print("[SoundScript] Initialized successfully.")
`;
            fullLuaScriptOutput.value = fullLuaScript;
            // --- End of Full Lua Script Generation ---

            resultsDiv.style.display = 'block';
            statusMessage.textContent = 'Done! Outputs generated below.';
            statusMessage.style.color = 'green';

        } catch (error) {
            console.error('Error during generation:', error);
            statusMessage.textContent = `Error: ${error.toString()}`;
            statusMessage.style.color = 'red';
            alert('An error occurred during generation: ' + error.toString());
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = originalButtonText; // Restore original button text
        }
    });

    // Helper function to convert AudioBuffer to WAV Blob
    function audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        let result;
        if (numChannels === 2) {
            result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
        } else {
            // For mono, just use the first channel. If buffer has more than 2, this only takes the first.
            // Consider mixing down if source can have >2 channels and output WAV should be stereo/mono.
            // For typical web audio, sources are often mono or stereo.
            result = buffer.getChannelData(0);
        }
        return encodeWAV(result, numChannels === 1 ? 1 : numChannels, sampleRate, bitDepth); // Pass actual numChannels for WAV header
    }

    function encodeWAV(samples, numChannels, sampleRate, bitDepth) {
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * bytesPerSample, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true); // byteRate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * bytesPerSample, true);
        floatTo16BitPCM(view, 44, samples);
        return new Blob([view], { type: 'audio/wav' });
    }

    function interleave(inputL, inputR) {
        const length = inputL.length + inputR.length;
        const result = new Float32Array(length);
        let index = 0, inputIndex = 0;
        while (index < length) {
            result[index++] = inputL[inputIndex];
            result[index++] = inputR[inputIndex];
            inputIndex++;
        }
        return result;
    }

    function floatTo16BitPCM(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    // Copy to Clipboard functionality
    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.dataset.target;
            const textarea = document.getElementById(targetId);
            const originalText = button.textContent;
            try {
                await navigator.clipboard.writeText(textarea.value);
                button.textContent = 'Copied!';
            } catch (err) {
                console.error('Failed to copy with navigator.clipboard: ', err);
                // Fallback for older browsers or if clipboard API fails/is not permitted
                textarea.select();
                textarea.setSelectionRange(0, 99999); // For mobile devices
                try {
                    document.execCommand('copy');
                    button.textContent = 'Copied! (fallback)';
                } catch (execErr) {
                    console.error('Failed to copy with document.execCommand: ', execErr);
                    button.textContent = 'Copy Failed';
                    alert('Failed to copy text. Please copy manually.');
                }
                window.getSelection()?.removeAllRanges(); // Deselect
            } finally {
                setTimeout(() => { button.textContent = originalText; }, 2000);
            }
        });
    });

    renderQueue(); // Initial render
});