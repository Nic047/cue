use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample};
use serde::Serialize;
use std::io::Cursor;
use std::sync::mpsc::{self, Sender};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

pub struct NativeAudio {
    commands: Sender<AudioCommand>,
    selected: Mutex<Option<String>>,
    level: Arc<AtomicU32>,
    error: Arc<Mutex<Option<String>>>,
    device: Arc<Mutex<String>>,
}

enum AudioCommand {
    Start(Sender<Result<String, String>>, Option<String>, bool),
    Stop(Sender<Result<FinishedRecording, String>>),
    Cancel,
    CancelCheck,
}

struct ActiveRecording {
    stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    channels: u16,
    device: String,
    started: Instant,
    monitor: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedRecording {
    data_uri: String,
    device: String,
    max_peak: f32,
    duration_ms: u128,
}

impl Default for NativeAudio {
    fn default() -> Self {
        Self::with_device(None)
    }
}

impl NativeAudio {
    pub fn with_device(selected: Option<String>) -> Self {
        let (commands, receiver) = mpsc::channel();
        let level = Arc::new(AtomicU32::new(0));
        let error = Arc::new(Mutex::new(None));
        let device = Arc::new(Mutex::new(String::new()));
        let (worker_level, worker_error, worker_device) =
            (level.clone(), error.clone(), device.clone());
        std::thread::spawn(move || {
            audio_worker(receiver, worker_level, worker_error, worker_device)
        });
        Self {
            commands,
            selected: Mutex::new(selected),
            level,
            error,
            device,
        }
    }
}

fn audio_worker(
    receiver: mpsc::Receiver<AudioCommand>,
    level: Arc<AtomicU32>,
    error: Arc<Mutex<Option<String>>>,
    device: Arc<Mutex<String>>,
) {
    let mut active = None;
    while let Ok(command) = receiver.recv() {
        match command {
            AudioCommand::Start(reply, selected, monitor) => {
                level.store(0, Ordering::Relaxed);
                *error.lock().unwrap() = None;
                let result =
                    start_capture(&mut active, selected, level.clone(), error.clone(), monitor);
                match &result {
                    Ok(name) => *device.lock().unwrap() = name.clone(),
                    Err(message) => *error.lock().unwrap() = Some(message.clone()),
                }
                let _ = reply.send(result);
            }
            AudioCommand::Stop(reply) => {
                let result = active
                    .take()
                    .ok_or_else(|| "Keine Aufnahme aktiv.".to_string())
                    .and_then(finish_capture);
                let _ = reply.send(result);
                level.store(0, Ordering::Relaxed);
            }
            AudioCommand::Cancel => {
                active = None;
                level.store(0, Ordering::Relaxed);
            }
            AudioCommand::CancelCheck => {
                if active.as_ref().is_some_and(|recording| recording.monitor) {
                    active = None;
                    level.store(0, Ordering::Relaxed);
                }
            }
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    level: Arc<AtomicU32>,
    error: Arc<Mutex<Option<String>>>,
    monitor: bool,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            let peak = data.iter().fold(0.0_f32, |peak, sample| {
                peak.max(f32::from_sample(*sample).abs())
            });
            level.store(peak.to_bits(), Ordering::Relaxed);
            if !monitor {
                if let Ok(mut buffer) = samples.try_lock() {
                    buffer.extend(data.iter().map(|sample| f32::from_sample(*sample)));
                }
            }
        },
        move |failure| {
            *error.lock().unwrap() = Some(format!("Microphone disconnected: {failure}"));
        },
        None,
    )
}

fn start_capture(
    active: &mut Option<ActiveRecording>,
    selected: Option<String>,
    level: Arc<AtomicU32>,
    error: Arc<Mutex<Option<String>>>,
    monitor: bool,
) -> Result<String, String> {
    if active.is_some() {
        return Err("Eine Aufnahme läuft bereits.".into());
    }
    let started = Instant::now();
    let host = cpal::default_host();
    let device = if let Some(name) = selected {
        host.input_devices()
            .map_err(|e| e.to_string())?
            .find(|device| device.name().ok().as_ref() == Some(&name))
    } else {
        host.default_input_device()
    }
    .ok_or_else(|| "Kein Standardmikrofon verfügbar.".to_string())?;
    let device_name = device.name().unwrap_or_else(|_| "Mikrofon".into());
    let supported = device
        .default_input_config()
        .map_err(|e| format!("Mikrofon konnte nicht geöffnet werden: {e}"))?;
    let config: cpal::StreamConfig = supported.clone().into();
    let sample_rate = config.sample_rate.0;
    let channels = config.channels;
    let samples = Arc::new(Mutex::new(Vec::new()));
    let stream = match supported.sample_format() {
        cpal::SampleFormat::I8 => build_stream::<i8>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::I16 => build_stream::<i16>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::I32 => build_stream::<i32>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::I64 => build_stream::<i64>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::U8 => build_stream::<u8>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::U16 => build_stream::<u16>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::U32 => build_stream::<u32>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::U64 => build_stream::<u64>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::F32 => build_stream::<f32>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        cpal::SampleFormat::F64 => build_stream::<f64>(
            &device,
            &config,
            samples.clone(),
            level.clone(),
            error.clone(),
            monitor,
        ),
        format => return Err(format!("Nicht unterstütztes Mikrofonformat: {format}")),
    }
    .map_err(|e| format!("Mikrofonstart fehlgeschlagen: {e}"))?;
    stream
        .play()
        .map_err(|e| format!("Mikrofonstart fehlgeschlagen: {e}"))?;

    *active = Some(ActiveRecording {
        stream,
        samples,
        sample_rate,
        channels,
        device: device_name.clone(),
        started,
        monitor,
    });
    eprintln!(
        "[island] Native Aufnahme bereit in {:?}: {device_name} ({sample_rate}Hz)",
        started.elapsed()
    );
    Ok(device_name)
}

fn finish_capture(recording: ActiveRecording) -> Result<FinishedRecording, String> {
    let ActiveRecording {
        stream,
        samples,
        sample_rate,
        channels,
        device,
        started,
        monitor: _,
    } = recording;
    drop(stream);
    let samples = samples.lock().map_err(|e| e.to_string())?;
    let duration_ms = started.elapsed().as_millis();
    let max_peak = samples
        .iter()
        .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
    let mono = samples
        .chunks(channels as usize)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect::<Vec<_>>();
    let output_len = mono.len() * 16_000 / sample_rate as usize;
    let resampled = (0..output_len)
        .map(|index| {
            let position = index as f64 * sample_rate as f64 / 16_000.0;
            let left = position.floor() as usize;
            let right = (left + 1).min(mono.len().saturating_sub(1));
            let fraction = (position - left as f64) as f32;
            mono[left] + (mono[right] - mono[left]) * fraction
        })
        .collect::<Vec<_>>();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|e| format!("WAV konnte nicht erstellt werden: {e}"))?;
        for sample in resampled {
            let pcm = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer
                .write_sample(pcm)
                .map_err(|e| format!("WAV konnte nicht geschrieben werden: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("WAV konnte nicht abgeschlossen werden: {e}"))?;
    }
    drop(samples);
    let data_uri = format!(
        "data:audio/wav;base64,{}",
        STANDARD.encode(cursor.into_inner())
    );
    Ok(FinishedRecording {
        data_uri,
        device,
        max_peak,
        duration_ms,
    })
}

#[tauri::command]
pub fn start_audio_recording(state: State<'_, NativeAudio>) -> Result<String, String> {
    let (reply, response) = mpsc::channel();
    state
        .commands
        .send(AudioCommand::Start(
            reply,
            state.selected.lock().unwrap().clone(),
            false,
        ))
        .map_err(|e| e.to_string())?;
    response.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stop_audio_recording(state: State<'_, NativeAudio>) -> Result<FinishedRecording, String> {
    let (reply, response) = mpsc::channel();
    state
        .commands
        .send(AudioCommand::Stop(reply))
        .map_err(|e| e.to_string())?;
    response.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_audio_recording(state: State<'_, NativeAudio>) {
    let _ = state.commands.send(AudioCommand::Cancel);
}

#[derive(Serialize)]
pub struct MicrophoneLevel {
    level: f32,
    device: String,
    error: Option<String>,
}

#[tauri::command]
pub fn audio_inputs() -> Result<Vec<String>, String> {
    Ok(cpal::default_host()
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|device| device.name().ok())
        .collect())
}

#[tauri::command]
pub fn select_audio_input(
    app: AppHandle,
    state: State<'_, NativeAudio>,
    name: Option<String>,
) -> Result<(), String> {
    if let Some(name) = &name {
        if !audio_inputs()?.contains(name) {
            return Err("This microphone is no longer connected.".into());
        }
    }
    super::onboarding::save_microphone(&app, name.clone())?;
    *state.selected.lock().unwrap() = name;
    Ok(())
}

#[tauri::command]
pub fn start_mic_check(state: State<'_, NativeAudio>) -> Result<String, String> {
    let (reply, response) = mpsc::channel();
    state
        .commands
        .send(AudioCommand::CancelCheck)
        .map_err(|e| e.to_string())?;
    state
        .commands
        .send(AudioCommand::Start(
            reply,
            state.selected.lock().unwrap().clone(),
            true,
        ))
        .map_err(|e| e.to_string())?;
    response.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn microphone_level(state: State<'_, NativeAudio>) -> MicrophoneLevel {
    MicrophoneLevel {
        level: f32::from_bits(state.level.load(Ordering::Relaxed)),
        device: state.device.lock().unwrap().clone(),
        error: state.error.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn stop_mic_check(state: State<'_, NativeAudio>) {
    let _ = state.commands.send(AudioCommand::CancelCheck);
}

pub fn cancel_check(app: &AppHandle) {
    if let Some(state) = app.try_state::<NativeAudio>() {
        let _ = state.commands.send(AudioCommand::CancelCheck);
    }
}
