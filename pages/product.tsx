"use client"

import { useState, FormEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import DatePicker from 'react-datepicker';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { Protect, PricingTable, UserButton } from '@clerk/nextjs';

type StreamPayload = {
    detail?: string;
    errors?: string[];
    level?: 'info' | 'success' | 'warning' | 'error';
    message?: string;
    model?: string;
    provider?: string;
    text?: string;
    wire_api?: string;
};

type StatusEntry = StreamPayload & {
    id: number;
    time: string;
};

function parsePayload(data: string): StreamPayload | null {
    try {
        return JSON.parse(data) as StreamPayload;
    } catch {
        return null;
    }
}

function ConsultationForm() {
    const { getToken } = useAuth();

    // Form state
    const [patientName, setPatientName] = useState('');
    const [visitDate, setVisitDate] = useState<Date | null>(new Date());
    const [notes, setNotes] = useState('');

    // Streaming state
    const [output, setOutput] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeModel, setActiveModel] = useState('');
    const [statusLog, setStatusLog] = useState<StatusEntry[]>([]);

    function appendStatus(payload: StreamPayload) {
        const entry: StatusEntry = {
            ...payload,
            id: Date.now() + Math.random(),
            time: new Date().toLocaleTimeString(),
        };

        setStatusLog((current) => [...current, entry].slice(-12));

        if (payload.provider && payload.model && payload.level !== 'error' && payload.level !== 'warning') {
            setActiveModel(`${payload.provider} / ${payload.model}`);
        }
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setOutput('');
        setLoading(true);
        setActiveModel('');
        setStatusLog([]);

        const jwt = await getToken();
        if (!jwt) {
            setOutput('Authentication required');
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        let buffer = '';

        await fetchEventSource('/api', {
            signal: controller.signal,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
                patient_name: patientName,
                date_of_visit: visitDate?.toISOString().slice(0, 10),
                notes,
            }),
            onmessage(ev) {
                const payload = parsePayload(ev.data);

                if (!payload) {
                    buffer += ev.data;
                    setOutput(buffer);
                    return;
                }

                if (ev.event === 'token') {
                    buffer += payload.text ?? '';
                    setOutput(buffer);
                    return;
                }

                if (ev.event === 'status') {
                    appendStatus(payload);
                    return;
                }

                if (ev.event === 'done') {
                    appendStatus({
                        ...payload,
                        level: 'success',
                    });
                    setLoading(false);
                    return;
                }

                if (ev.event === 'error') {
                    appendStatus({
                        ...payload,
                        level: 'error',
                    });
                    setLoading(false);
                }
            },
            onclose() { 
                setLoading(false); 
            },
            onerror(err) {
                console.error('SSE error:', err);
                appendStatus({
                    level: 'error',
                    message: 'The streaming connection failed.',
                    detail: String(err),
                });
                controller.abort();
                setLoading(false);
            },
        });
    }

    return (
        <div className="container mx-auto px-4 py-12 max-w-3xl">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-8">
                Consultation Notes
            </h1>

            <form onSubmit={handleSubmit} className="space-y-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8">
                <div className="space-y-2">
                    <label htmlFor="patient" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Patient Name
                    </label>
                    <input
                        id="patient"
                        type="text"
                        required
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                        placeholder="Enter patient's full name"
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Date of Visit
                    </label>
                    <DatePicker
                        id="date"
                        selected={visitDate}
                        onChange={(d: Date | null) => setVisitDate(d)}
                        dateFormat="yyyy-MM-dd"
                        placeholderText="Select date"
                        required
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Consultation Notes
                    </label>
                    <textarea
                        id="notes"
                        required
                        rows={8}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                        placeholder="Enter detailed consultation notes..."
                    />
                </div>

                <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
                >
                    {loading ? 'Generating Summary...' : 'Generate Summary'}
                </button>
            </form>

            {(loading || statusLog.length > 0) && (
                <section className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            Generation status
                        </h2>
                        {activeModel && (
                            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 rounded-full">
                                {activeModel}
                            </span>
                        )}
                    </div>
                    <ol className="space-y-3">
                        {statusLog.map((entry) => (
                            <li key={entry.id} className="flex gap-3 text-sm">
                                <span
                                    className={[
                                        'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                                        entry.level === 'success' ? 'bg-green-500' : '',
                                        entry.level === 'warning' ? 'bg-amber-500' : '',
                                        entry.level === 'error' ? 'bg-red-500' : '',
                                        !entry.level || entry.level === 'info' ? 'bg-blue-500' : '',
                                    ].join(' ')}
                                />
                                <div className="min-w-0">
                                    <p className="text-gray-800 dark:text-gray-200">
                                        {entry.message}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {entry.time}
                                        {entry.provider && entry.model ? ` • ${entry.provider} • ${entry.model}` : ''}
                                        {entry.wire_api ? ` • ${entry.wire_api}` : ''}
                                    </p>
                                    {entry.detail && (
                                        <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">
                                            {entry.detail}
                                        </p>
                                    )}
                                    {entry.errors && entry.errors.length > 0 && (
                                        <ul className="mt-2 list-disc pl-5 text-xs text-gray-500 dark:text-gray-400">
                                            {entry.errors.map((error) => (
                                                <li key={error}>{error}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {output && (
                <section className="mt-8 bg-gray-50 dark:bg-gray-800 rounded-xl shadow-lg p-8">
                    <div className="markdown-content prose prose-blue dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                            {output}
                        </ReactMarkdown>
                    </div>
                </section>
            )}
        </div>
    );
}

export default function Product() {
    return (
        <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
            {/* User Menu in Top Right */}
            <div className="absolute top-4 right-4">
                <UserButton showName={true} />
            </div>

            {/* Subscription Protection */}
            <Protect
                plan="premium_subscription"
                fallback={
                    <div className="container mx-auto px-4 py-12">
                        <header className="text-center mb-12">
                            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">
                                Healthcare Professional Plan
                            </h1>
                            <p className="text-gray-600 dark:text-gray-400 text-lg mb-8">
                                Streamline your patient consultations with AI-powered summaries
                            </p>
                        </header>
                        <div className="max-w-4xl mx-auto">
                            <PricingTable />
                        </div>
                    </div>
                }
            >
                <ConsultationForm />
            </Protect>
        </main>
    );
}
