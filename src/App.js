/* global pako */
import React, { useState, useEffect } from 'react';
import { Lock, Unlock, Upload, FileImage, CheckCircle, XCircle, KeyRound, ScanEye, Server, Image as ImageIcon } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { Info } from 'lucide-react';
import MatrixRain from './components/MatrixRain';
// eslint-disable-next-line no-unused-vars
import TypeWriter from './components/TypeWriter';
import ClientImageProcessor from './services/ClientImageProcessor';
import './App.css';

const FileDropzone = ({ onDrop, file, title, subtitle, accept, error }) => {
  const [dragActive, setDragActive] = useState(false);
  const handleDrag = (e) => { e.preventDefault(); e.stopPropagation(); if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true); else if (e.type === 'dragleave') setDragActive(false); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); if (e.dataTransfer.files?.[0]) onDrop(e.dataTransfer.files[0]); };
  const handleFileChange = (e) => { if (e.target.files?.[0]) onDrop(e.target.files[0]); };
  return (
    <div onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop} className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 ${dragActive ? 'border-green-400 bg-green-500/10' : 'border-green-500/40 hover:border-green-400/60'} ${error ? 'border-red-500/60' : ''}`}>
      <input type="file" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept={accept} />
      {file ? (
        <>
          <FileImage className="w-10 h-10 mx-auto mb-2 text-green-400" />
          <p className="text-sm text-green-400 font-semibold truncate" title={file.name}>{file.name}</p>
          <p className="text-xs text-green-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
        </>
      ) : (
        <>
          <Upload className="w-10 h-10 mx-auto mb-2 text-green-500/50" />
          <p className="text-base text-green-500 mb-1">{title}</p>
          <p className="text-sm text-green-700">{subtitle}</p>
        </>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
};

function App() {
  const [mode, setMode] = useState('crypt');
  const [stegoMode, setStegoMode] = useState('generate');
  const [payloadFile, setPayloadFile] = useState(null);
  const [carrierFile, setCarrierFile] = useState(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [shakePassword, setShakePassword] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [metadataError, setMetadataError] = useState(null);
  const [carrierImgSize, setCarrierImgSize] = useState(null);
  const [carrierError, setCarrierError] = useState(null);
  const [payloadTooLargeError, setPayloadTooLargeError] = useState(null);
  const [bitDepth, setBitDepth] = useState(1);
  const [minBitDepth, setMinBitDepth] = useState(1);

  useEffect(() => {
    setPayloadFile(null);
    setCarrierFile(null);
    setResult(null);
    setPassword('');
    setMetadata(null);
    setMetadataError(null);
    setCarrierImgSize(null);
    setCarrierError(null);
    setPayloadTooLargeError(null);
    setBitDepth(1);
    setMinBitDepth(1);
  }, [mode, stegoMode]);

  useEffect(() => {
    if (mode === 'decrypt' && payloadFile) {
      ClientImageProcessor.extractMetadataAsync(payloadFile).then(setMetadata).catch(err => setMetadataError(err.message));
    } else {
      setMetadata(null);
      setMetadataError(null);
    }
  }, [payloadFile, mode]);

  useEffect(() => {
    if (mode === 'crypt' && stegoMode === 'lsb' && carrierFile) {
      const img = new Image();
      img.onload = () => setCarrierImgSize({ width: img.width, height: img.height });
      img.onerror = () => setCarrierError('Could not read carrier image.');
      img.src = URL.createObjectURL(carrierFile);
    } else {
      setCarrierImgSize(null);
      setCarrierError(null);
    }
  }, [carrierFile, mode, stegoMode]);

  useEffect(() => {
    if (mode === 'crypt' && stegoMode === 'lsb' && payloadFile && carrierImgSize) {
      const checkCapacity = async () => {
        try {
          const payloadData = await ClientImageProcessor._readFileAsArrayBuffer(payloadFile);
          const compressedPayload = pako.deflate(payloadData);
          const header = ClientImageProcessor._createHeader(compressedPayload.byteLength, payloadFile.name, new Uint8Array(32), false, 1, true, 1);
          const requiredBytes = header.length + compressedPayload.byteLength;

          let foundMinDepth = false;
          for (let depth = 1; depth <= 8; depth++) {
            const capacity = Math.floor((carrierImgSize.width * carrierImgSize.height * 3 * depth) / 8);
            if (requiredBytes <= capacity) {
              setMinBitDepth(depth);
              setBitDepth(depth);
              setPayloadTooLargeError(null);
              foundMinDepth = true;
              break;
            }
          }
          if (!foundMinDepth) {
            const maxCapacity = Math.floor((carrierImgSize.width * carrierImgSize.height * 3 * 8) / 8);
            setPayloadTooLargeError(`File is too large. Max capacity at 8 bits: ${(maxCapacity / 1024).toFixed(2)} KB.`);
          }
        } catch (e) {
          setPayloadTooLargeError('Could not calculate required capacity.');
        }
      };
      checkCapacity();
    } else {
      setPayloadTooLargeError(null);
    }
  }, [payloadFile, carrierImgSize, mode, stegoMode]);

  const triggerPasswordShake = () => {
    setShakePassword(true);
    setTimeout(() => setShakePassword(false), 500);
  };

  const handleProcess = async () => {
    if (!payloadFile || (mode === 'crypt' && stegoMode === 'lsb' && !carrierFile)) return;
    if (payloadTooLargeError) {
      setResult({ success: false, message: payloadTooLargeError });
      return;
    }

    setLoading(true);
    setProgress(0);
    setResult(null);
    const usePassword = password.length > 0 ? password : null;

    try {
      let blob, outputFilename;
      if (mode === 'crypt') {
        const baseName = payloadFile.name.lastIndexOf('.') > 0 ? payloadFile.name.substring(0, payloadFile.name.lastIndexOf('.')) : payloadFile.name;
        if (stegoMode === 'generate') {
          blob = await ClientImageProcessor.createCarrierImageAsync(payloadFile, usePassword, setProgress);
          outputFilename = `${baseName}-generated.png`;
        } else {
          blob = await ClientImageProcessor.hideInExistingImageAsync(payloadFile, carrierFile, usePassword, bitDepth, setProgress);
          outputFilename = `${baseName}-lsb-encoded.png`;
        }
      } else {
        const extracted = await ClientImageProcessor.extractFileAsync(payloadFile, usePassword, setProgress);
        blob = new Blob([extracted.data]);
        const originalName = extracted.fileName;
        const lastDotIndex = originalName.lastIndexOf('.');
        outputFilename = lastDotIndex > 0 ? `${originalName.substring(0, lastDotIndex)}-decrypted${originalName.substring(lastDotIndex)}` : `${originalName}-decrypted`;
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', outputFilename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setResult({ success: true, filename: outputFilename, size: `${(blob.size / 1024 / 1024).toFixed(2)} MB` });
    } catch (error) {
      if (mode === 'decrypt' && error.message.includes('Decryption failed')) {
        setResult({ success: false, message: 'Incorrect Password. Please try again.' });
        triggerPasswordShake();
      } else {
        setResult({ success: false, message: error.message });
      }
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  const renderCryptMode = () => {
    const capacityForDepth = (depth) => carrierImgSize ? Math.floor((carrierImgSize.width * carrierImgSize.height * 3 * depth) / 8) : 0;
    return (
      <>
        <div className="max-w-2xl mx-auto mb-6">
          <div className="backdrop-blur-xl bg-black/30 border border-green-500/30 rounded-lg p-1 shadow-[0_0_30px_rgba(0,255,65,0.15)]">
            <div className="mode-selector-container grid grid-cols-2 gap-1 sm:gap-2">
              <div className={`moving-border ${stegoMode === 'lsb' ? 'decrypt' : ''}`}></div>
              <button onClick={() => setStegoMode('generate')} className="mode-selector-button flex items-center justify-center gap-2 py-3 px-4 sm:py-4 sm:px-6 text-green-400" style={{ outline: 'none', boxShadow: 'none', border: 'none', backgroundColor: 'transparent' }}>
                <Server className="w-5 h-5" /><span className="font-semibold tracking-wider text-sm sm:text-base">NEW IMAGE</span>
              </button>
              <button onClick={() => setStegoMode('lsb')} className="mode-selector-button flex items-center justify-center gap-2 py-3 px-4 sm:py-4 sm:px-6 text-green-400" style={{ outline: 'none', boxShadow: 'none', border: 'none', backgroundColor: 'transparent' }}>
                <ImageIcon className="w-5 h-5" /><span className="font-semibold tracking-wider text-sm sm:text-base">EXISTING IMAGE</span>
              </button>
            </div>
          </div>
        </div>
        {stegoMode === 'generate' ? (
          <FileDropzone onDrop={setPayloadFile} file={payloadFile} title="Drop Secret File Here" subtitle="or click to browse" />
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <FileDropzone onDrop={setPayloadFile} file={payloadFile} title="1. Drop Secret File" subtitle="The file to hide" error={payloadTooLargeError} />
              <FileDropzone onDrop={setCarrierFile} file={carrierFile} title="2. Drop Carrier Image" subtitle="The image to hide in" accept="image/png" error={carrierError} />
            </div>
            {carrierImgSize && payloadFile && !payloadTooLargeError && (
              <div className="mt-4 pt-4 border-t border-green-500/20">
                <label htmlFor="bitDepth" className="block text-sm font-medium text-green-400 mb-2">Quality vs. Capacity (Bit Depth)</label>
                <input type="range" id="bitDepth" min={minBitDepth} max="8" value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value))} className="w-full h-2 bg-green-900/50 rounded-lg appearance-none cursor-pointer" />
                <div className="flex justify-between text-xs text-green-600 mt-1">
                  <span>{minBitDepth} (Best Quality)</span>
                  <span>{bitDepth}</span>
                  <span>8 (Max Capacity)</span>
                </div>
                <p className="text-center text-sm text-green-400 mt-2">
                  Selected Capacity: <span className="font-bold text-white">{(capacityForDepth(bitDepth) / 1024).toFixed(2)} KB</span>
                </p>
              </div>
            )}
          </>
        )}
      </>
    );
  };

  const renderDecryptMode = () => (
    <>
      <FileDropzone onDrop={setPayloadFile} file={payloadFile} title="Drop PNG to Extract From" subtitle="or click to browse" accept="image/png" />
      {mode === 'decrypt' && payloadFile && metadata && (
        <div className="mt-4 pt-4 border-t border-green-500/20 text-left">
          <h4 className="flex items-center gap-2 text-green-400 font-bold mb-2"><ScanEye className="w-5 h-5"/> Embedded File Info:</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-green-600">Filename:</span><span className="text-white truncate ml-4" title={metadata.fileName}>{metadata.fileName}</span></div>
            <div className="flex justify-between"><span className="text-green-600">Size:</span><span className="text-white">{(metadata.fileSize / 1024).toFixed(2)} KB</span></div>
            <div className="flex justify-between"><span className="text-green-600">Encrypted:</span><span className="text-white">{metadata.isEncrypted ? 'Yes' : 'No'}</span></div>
          </div>
        </div>
      )}
      {metadataError && <p className="text-sm text-red-400 mt-2 text-center">{metadataError}</p>}
    </>
  );

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono relative overflow-hidden">
      <MatrixRain />
      <div className="relative z-10 min-h-screen p-4 md:p-8">
        <header className="mb-8 sm:mb-12 text-center">
          <div className="inline-block">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-white drop-shadow-[0_0_20px_rgba(0,255,65,0.5)]">SHADE_OF_COLOR_2</h1>
            <p className="text-sm text-green-500 tracking-widest">&gt; STEGANOGRAPHY SYSTEM v2.4 (SMART LSB)</p>
          </div>
        </header>
        <div className="max-w-2xl mx-auto mb-8">
          <div className="backdrop-blur-xl bg-black/30 border border-green-500/30 rounded-lg p-1 shadow-[0_0_30px_rgba(0,255,65,0.15)]">
            <div className="mode-selector-container grid grid-cols-2 gap-1 sm:gap-2">
              <div className={`moving-border ${mode === 'decrypt' ? 'decrypt' : ''}`}></div>
              <button onClick={() => setMode('crypt')} className="mode-selector-button flex items-center justify-center gap-2 py-3 px-4 sm:py-4 sm:px-6 text-green-400" style={{ outline: 'none', boxShadow: 'none', border: 'none', backgroundColor: 'transparent' }}>
                <Lock className="w-5 h-5" /><span className="font-semibold tracking-wider text-sm sm:text-base">HIDE</span>
              </button>
              <button onClick={() => setMode('decrypt')} className="mode-selector-button flex items-center justify-center gap-2 py-3 px-4 sm:py-4 sm:px-6 text-green-400" style={{ outline: 'none', boxShadow: 'none', border: 'none', backgroundColor: 'transparent' }}>
                <Unlock className="w-5 h-5" /><span className="font-semibold tracking-wider text-sm sm:text-base">EXTRACT</span>
              </button>
            </div>
          </div>
        </div>
        <div className="max-w-4xl mx-auto">
          <div className="backdrop-blur-2xl bg-gradient-to-br from-black/50 to-green-950/10 border border-green-500/30 rounded-2xl p-4 sm:p-6 md:p-8 shadow-[0_0_50px_rgba(0,255,65,0.2)]">
            {mode === 'crypt' ? renderCryptMode() : renderDecryptMode()}
            {payloadFile && (
              <div className="mt-6 space-y-4">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-700" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter Password (Optional)" className={`w-full bg-black/30 border border-green-500/30 rounded-lg py-3 pr-4 pl-10 text-green-300 placeholder-green-700 focus:ring-1 focus:ring-green-500 ${shakePassword ? 'shake' : ''}`} />
                </div>
                <div className="relative">
                  <button onClick={handleProcess} disabled={loading || payloadTooLargeError} className={`w-full py-4 px-6 font-bold rounded-lg transition-all duration-300 tracking-wider relative overflow-hidden ${loading || payloadTooLargeError ? 'bg-gray-700/20 text-gray-400 border border-gray-500/40 cursor-not-allowed' : 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-black shadow-[0_0_30px_rgba(0,255,65,0.4)] hover:shadow-[0_0_50px_rgba(0,255,65,0.6)]'}`}>
                    <span className="relative z-10 flex items-center justify-center gap-3">
                      {loading ? <><span className="text-sm font-mono">{progress}%</span><span>PROCESSING...</span></> : <>{mode === 'crypt' ? 'HIDE FILE' : 'EXTRACT FILE'}</>}
                    </span>
                    {loading && (<div className="absolute inset-0 bg-gradient-to-r from-green-500 to-green-400 opacity-40 transition-all duration-500 ease-out rounded-lg" style={{ width: `${progress}%` }}/>)}
                  </button>
                </div>
              </div>
            )}
            {result && (
              <div className={`mt-6 backdrop-blur-xl border rounded-lg p-4 sm:p-6 shadow-[0_0_20px_rgba(0,255,65,0.15)] transition-all duration-500 animate-fade-in ${result.success ? 'bg-green-950/20 border-green-500/40' : 'bg-red-950/20 border-red-500/40'}`}>
                <div className="flex items-start gap-4">
                  {result.success ? <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0 mt-1" /> : <XCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-1" />}
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-green-400 mb-3">&gt; {result.success ? 'SUCCESS' : 'ERROR'}</h3>
                    {result.success ? (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-green-600">Output:</span><span className="text-white">{result.filename}</span></div>
                        <div className="flex justify-between"><span className="text-green-600">Size:</span><span className="text-white">{result.size}</span></div>
                      </div>
                    ) : (<p className="text-red-400">{result.message}</p>)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="max-w-4xl mx-auto mt-8">
          <div className="backdrop-blur-2xl bg-gradient-to-br from-black/50 to-green-950/10 border border-green-500/30 rounded-2xl p-4 sm:p-6 md:p-8 shadow-[0_0_50px_rgba(0,255,65,0.2)]">
            <h2 className="text-xl sm:text-2xl font-bold text-green-400 mb-4 text-center">&gt; HOW TO USE</h2>
            <div className="grid md:grid-cols-2 gap-6 text-sm text-green-300">
              <div>
                <h3 className="text-green-400 font-semibold mb-2">HIDE MODE:</h3>
                <ul className="space-y-1 text-green-600">
                  <li>• Choose "New Image" or "Existing Image"</li>
                  <li>• Drop your secret file</li>
                  <li>• For existing image: drop carrier PNG</li>
                  <li>• Add password (optional)</li>
                  <li>• Click "HIDE FILE"</li>
                </ul>
              </div>
              <div>
                <h3 className="text-green-400 font-semibold mb-2">EXTRACT MODE:</h3>
                <ul className="space-y-1 text-green-600">
                  <li>• Drop the carrier PNG image</li>
                  <li>• Enter password if encrypted</li>
                  <li>• Click "EXTRACT FILE"</li>
                  <li>• Original file downloads automatically</li>
                </ul>
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-green-500/20">
              <h3 className="text-green-400 font-semibold mb-2 text-center">FEATURES:</h3>
              <div className="text-center text-green-600 text-sm">
                <span>100% Client-Side • AES-256 Encryption • SHA-256 Integrity • LSB Steganography • Large File Support</span>
              </div>
            </div>
          </div>
        </div>
        
        <footer className="text-center mt-8 text-green-600 text-sm">
          <div className="space-x-4">
            <a href="https://github.com/archistico/ShadeOfColor2" target="_blank" rel="noopener noreferrer" className="hover:text-green-400 transition-colors">
              Original C# Project
            </a>
            <span>•</span>
            <a href="https://github.com/FettahFT/SOC2-web" target="_blank" rel="noopener noreferrer" className="hover:text-green-400 transition-colors">
              Web App Fork
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;