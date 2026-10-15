import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, Calendar as CalendarIcon, ChevronLeft, ChevronRight, 
  Plus, X, Image as ImageIcon, CheckCircle, Clock, XCircle, Trash2
} from 'lucide-react';

async function requestApi(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || 'The request failed. Please try again.');
  }
  return result;
}

function Avatar({ person, className }) {
  const [failed, setFailed] = useState(false);
  if (person.imageUrl && !failed) {
    return <img src={person.imageUrl} alt="" className={className} onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden="true" className={`${className} inline-flex items-center justify-center bg-blue-100 text-blue-800 text-xs font-semibold`}>
      {person.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}
    </span>
  );
}

function Dialog({ labelledBy, onClose, busy, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    const handleKey = (event) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    if (!dialog.contains(document.activeElement)) (focusable()[0] || dialog).focus();
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={labelledBy} tabIndex={-1} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// --- Utility Functions ---
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      reject(new Error('Choose a JPG, PNG, or WebP image smaller than 5 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height && width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        } else if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Your browser could not process this image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('This image could not be read. Choose another file.'));
    };
    reader.onerror = () => reject(new Error('This file could not be read. Choose another image.'));
  });
};

const formatDateString = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

export default function PartyTracker() {
  const [roster, setRoster] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rosterError, setRosterError] = useState('');
  const [savingPerson, setSavingPerson] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [deletingPerson, setDeletingPerson] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Modals State
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [selectedEventDate, setSelectedEventDate] = useState(null);
  
  // Roster Form State
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonImage, setNewPersonImage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await requestApi('tracker', { signal: controller.signal });
        setRoster(data.roster);
        setEvents(data.events);
        setError('');
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [reloadKey]);

  const refresh = () => setReloadKey(value => value + 1);

  // --- Handlers ---
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setProcessingImage(true);
      setRosterError('');
      setNewPersonImage('');
      try {
        const compressedBase64 = await compressImage(file);
        setNewPersonImage(compressedBase64);
      } catch (error) {
        setRosterError(error.message);
      } finally {
        setProcessingImage(false);
      }
    }
  };

  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newPersonName.trim() || savingPerson || processingImage) return;
    setSavingPerson(true);
    setRosterError('');
    try {
      const person = await requestApi('roster', {
        method: 'POST',
        body: JSON.stringify({ name: newPersonName.trim(), image: newPersonImage || null }),
      });
      setRoster(current => [...current, person].sort((first, second) => first.name.localeCompare(second.name)));
      setNewPersonName('');
      setNewPersonImage('');
      setIsRosterModalOpen(false);
      refresh();
    } catch (err) {
      setRosterError(err.message);
    } finally {
      setSavingPerson(false);
    }
  };

  const handleDeletePerson = async (id) => {
    if (deletingPerson) return;
    setDeletingPerson(id);
    try {
      await requestApi(`roster/${id}`, { method: 'DELETE' });
      setRoster(current => current.filter(person => person.id !== id));
      setEvents(current => Object.fromEntries(Object.entries(current).filter(([, event]) => event.personId !== id)));
      refresh();
    } catch (err) {
      setError(err.message);
      setRosterError(err.message);
    } finally {
      setDeletingPerson(null);
    }
  };

  // Calendar Navigation
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const todayMonth = () => setCurrentDate(new Date());

  // --- Calendar Grid Generation ---
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    const days = [];
    // Padding for previous month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    // Actual days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentDate]);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (loading) {
    return (
      <div role="status" className="flex h-dvh bg-slate-50">
        <span className="sr-only">Loading Party Tracker…</span>
        <div aria-hidden="true" className="hidden md:block w-64 border-r border-slate-200 p-5 motion-safe:animate-pulse">
          <div className="h-6 w-40 rounded bg-slate-200 mb-10" />
          <div className="h-4 w-20 rounded bg-slate-200 mb-6" />
          <div className="h-9 rounded bg-slate-200" />
        </div>
        <div aria-hidden="true" className="flex-1 flex flex-col motion-safe:animate-pulse">
          <div className="h-16 border-b border-slate-200 bg-white p-4"><div className="h-7 w-52 rounded bg-slate-200" /></div>
          <div className="flex-1 grid grid-cols-7 grid-rows-5 gap-px bg-slate-200">
            {Array.from({ length: 35 }, (_, index) => <div key={index} className="bg-white" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-white overflow-hidden font-sans text-slate-800">
      
      {/* Sidebar - Roster */}
      <div className="w-64 border-r border-slate-200 bg-slate-50 flex flex-col hidden md:flex">
        <div className="p-4 border-b border-slate-200">
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarIcon className="text-blue-600" />
            Party Tracker
          </h1>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Roster</h2>
            <button 
              onClick={() => setIsRosterModalOpen(true)}
              className="p-1 text-blue-600 hover:bg-blue-100 rounded-full transition-colors"
              title="Add Person"
            >
              <Plus size={18} />
            </button>
          </div>
          
          {roster.length === 0 ? (
            <p className="text-sm text-slate-400">No members yet. Add someone to start assigning!</p>
          ) : (
            <div className="space-y-2">
              {roster.map(person => (
                <div key={person.id} className="flex items-center justify-between group p-2 hover:bg-slate-100 rounded-lg transition-colors">
                  <div className="flex items-center gap-3">
                    <Avatar person={person} className="w-8 h-8 shrink-0 rounded-full object-cover border border-slate-200 shadow-sm" />
                    <span className="text-sm font-medium break-words min-w-0">{person.name}</span>
                  </div>
                  <button 
                    onClick={() => handleDeletePerson(person.id)}
                    disabled={Boolean(deletingPerson)}
                    aria-label={`Remove ${person.name} and their events`}
                    className="opacity-70 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Calendar Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 bg-red-50 text-red-800 px-4 py-3 text-sm border-b border-red-200">
            <span>{error}</span>
            <button type="button" onClick={refresh} className="font-semibold underline">Retry</button>
          </div>
        )}
        {/* Calendar Header */}
        <header className="min-h-16 border-b border-slate-200 flex flex-wrap gap-2 items-center justify-between px-3 sm:px-6 py-3 bg-white shrink-0">
          <div className="flex items-center gap-2 sm:gap-4">
            <button onClick={todayMonth} className="px-4 py-1.5 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors">
              Today
            </button>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} aria-label="Previous month" className="p-1.5 hover:bg-slate-100 rounded-full transition-colors">
                <ChevronLeft size={20} />
              </button>
              <button onClick={nextMonth} aria-label="Next month" className="p-1.5 hover:bg-slate-100 rounded-full transition-colors">
                <ChevronRight size={20} />
              </button>
            </div>
            <h2 className="text-base sm:text-2xl font-normal text-slate-800 sm:ml-2" aria-live="polite">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h2>
          </div>
          
          <div className="md:hidden">
            <button onClick={() => setIsRosterModalOpen(true)} className="flex items-center gap-2 text-sm font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md">
              <Users size={16} /> Roster
            </button>
          </div>
        </header>

        {/* Calendar Grid */}
        <div className="flex-1 flex flex-col bg-slate-200 overflow-auto">
          {/* Days of week header */}
          <div className="grid grid-cols-7 bg-white border-b border-slate-200 shrink-0">
            {dayNames.map(day => (
              <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider border-r border-slate-200 last:border-r-0">
                {day}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="flex-1 grid grid-cols-7 auto-rows-fr gap-px bg-slate-200" style={{ gridTemplateRows: `repeat(${Math.ceil(calendarDays.length / 7)}, minmax(100px, 1fr))` }}>
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="bg-slate-50/50 min-h-[100px]" />;
              }

              const dateStr = formatDateString(date);
              const event = events[dateStr];
              const isToday = formatDateString(new Date()) === dateStr;
              const assignedPerson = event ? roster.find(p => p.id === event.personId) : null;

              return (
                <div 
                  key={dateStr} 
                  onClick={() => setSelectedEventDate(dateStr)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${date.toLocaleDateString(undefined, { dateStyle: 'full' })}${assignedPerson ? `, ${assignedPerson.name}, ${event.status}` : ', assign a host'}`}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                      keyEvent.preventDefault();
                      setSelectedEventDate(dateStr);
                    }
                  }}
                  className={`bg-white min-h-[100px] p-1.5 sm:p-2 cursor-pointer hover:bg-slate-50 transition-colors group relative ${isToday ? 'bg-blue-50/30' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <span className={`text-xs sm:text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>
                      {date.getDate()}
                    </span>
                  </div>

                  {event && assignedPerson && (
                    <div className={`mt-1 p-1 sm:p-1.5 rounded border ${
                      event.status === 'scheduled' ? 'bg-emerald-50 border-emerald-200' :
                      event.status === 'postponed' ? 'bg-amber-50 border-amber-200' :
                      'bg-slate-100 border-slate-200 opacity-60'
                    }`}>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Avatar person={assignedPerson} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full object-cover shrink-0" />
                        <div className="overflow-hidden">
                          <p className={`text-[10px] sm:text-xs font-semibold truncate ${
                            event.status === 'cancelled' ? 'line-through text-slate-500' : 'text-slate-800'
                          }`}>
                            {assignedPerson.name}
                          </p>
                          <p className="text-[9px] sm:text-[10px] uppercase tracking-wider font-bold mt-0.5" style={{
                            color: event.status === 'scheduled' ? '#059669' : event.status === 'postponed' ? '#d97706' : '#64748b'
                          }}>
                            {event.status}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {!event && (
                    <div className="opacity-0 group-hover:opacity-100 absolute bottom-2 right-2">
                       <Plus size={16} className="text-slate-400" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* --- Modals --- */}
      
      {/* Roster Modal */}
      {isRosterModalOpen && (
        <Dialog labelledBy="roster-title" onClose={() => setIsRosterModalOpen(false)} busy={savingPerson || processingImage}>
            <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
              <h3 id="roster-title" className="font-semibold text-slate-800">Manage Roster</h3>
              <button aria-label="Close roster" disabled={savingPerson || processingImage} onClick={() => setIsRosterModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            <form onSubmit={handleAddPerson} className="p-5 space-y-4">
              {rosterError && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{rosterError}</p>}
              {roster.length > 0 && (
                <ul className="space-y-2 border-b border-slate-200 pb-4">
                  {roster.map(person => (
                    <li key={person.id} className="flex items-center gap-3">
                      <Avatar person={person} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      <span className="flex-1 text-sm break-words min-w-0">{person.name}</span>
                      <button type="button" onClick={() => handleDeletePerson(person.id)} disabled={Boolean(deletingPerson) || savingPerson} aria-label={`Remove ${person.name} and their events`} className="text-red-500 p-2"><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <label htmlFor="member-name" className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input 
                  id="member-name" type="text" required maxLength={100} autoFocus
                  value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Profile Picture</label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-300 border-dashed rounded-lg hover:border-blue-400 transition-colors bg-slate-50 relative">
                  <div className="space-y-1 text-center">
                    {newPersonImage ? (
                      <img src={newPersonImage} alt="Preview" className="mx-auto h-24 w-24 rounded-full object-cover shadow-sm border border-slate-200" />
                    ) : (
                      <ImageIcon className="mx-auto h-12 w-12 text-slate-400" />
                    )}
                    <div className="flex text-sm text-slate-600 justify-center mt-2">
                      <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
                        <span>Upload a file</span>
                        <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" disabled={savingPerson || processingImage} onChange={handleImageUpload} />
                      </label>
                    </div>
                    <p className="text-xs text-slate-500">{processingImage ? 'Processing image…' : 'PNG, JPG, WebP up to 5 MB'}</p>
                  </div>
                </div>
              </div>
              <div className="pt-2">
                <button type="submit" disabled={savingPerson || processingImage || !newPersonName.trim()} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors">
                  {savingPerson ? 'Adding…' : 'Add Member'}
                </button>
              </div>
            </form>
        </Dialog>
      )}

      {/* Event Modal */}
      {selectedEventDate && (
        <EventModal 
          dateStr={selectedEventDate} 
          onClose={() => setSelectedEventDate(null)} 
          roster={roster}
          existingEvent={events[selectedEventDate]}
          onSaved={(saved) => {
            setEvents(current => ({ ...current, ...saved }));
            refresh();
          }}
          onDeleted={() => {
            setEvents(current => {
              const updated = { ...current };
              delete updated[selectedEventDate];
              return updated;
            });
            refresh();
          }}
        />
      )}

    </div>
  );
}

// --- Subcomponent: Event Modal ---
function EventModal({ dateStr, onClose, roster, existingEvent, onSaved, onDeleted }) {
  const [personId, setPersonId] = useState(existingEvent?.personId || '');
  const [status, setStatus] = useState(existingEvent?.status || 'scheduled');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    if (!personId || saving) return;
    setSaving(true);
    setError('');
    try {
      const data = await requestApi('events', {
        method: 'PUT',
        body: JSON.stringify({ date: dateStr, personId, status, recurringWeeks: !existingEvent && isRecurring ? recurringWeeks : 0 }),
      });
      onSaved(data.events);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await requestApi(`events/${dateStr}`, { method: 'DELETE' });
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const displayDate = new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <Dialog labelledBy="event-title" onClose={onClose} busy={saving}>
        
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <h3 id="event-title" className="font-semibold text-slate-800">
            {existingEvent ? 'Edit Party Details' : 'Assign Party Host'}
          </h3>
          <button onClick={onClose} disabled={saving} aria-label="Close event" className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5">
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{error}</p>}
          {roster.length === 0 && <p className="text-sm text-slate-600 bg-blue-50 rounded-lg p-3">Add a member using the Roster button before assigning a host.</p>}
          <div className="text-center mb-2">
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{displayDate}</p>
          </div>

          <div>
            <label htmlFor="event-host" className="block text-sm font-medium text-slate-700 mb-1">Host</label>
            <select 
              id="event-host"
              value={personId} 
              onChange={(e) => setPersonId(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              required
              autoFocus
            >
              <option value="" disabled>Select a person...</option>
              {roster.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <div className="grid grid-cols-3 gap-2">
              <label className={`flex flex-col items-center p-2 border rounded-lg cursor-pointer transition-colors ${status === 'scheduled' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="status" value="scheduled" checked={status === 'scheduled'} onChange={(e) => setStatus(e.target.value)} className="sr-only" />
                <CheckCircle size={20} className="mb-1" />
                <span className="text-xs font-semibold">Scheduled</span>
              </label>
              <label className={`flex flex-col items-center p-2 border rounded-lg cursor-pointer transition-colors ${status === 'postponed' ? 'bg-amber-50 border-amber-500 text-amber-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="status" value="postponed" checked={status === 'postponed'} onChange={(e) => setStatus(e.target.value)} className="sr-only" />
                <Clock size={20} className="mb-1" />
                <span className="text-xs font-semibold">Postponed</span>
              </label>
              <label className={`flex flex-col items-center p-2 border rounded-lg cursor-pointer transition-colors ${status === 'cancelled' ? 'bg-red-50 border-red-500 text-red-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="status" value="cancelled" checked={status === 'cancelled'} onChange={(e) => setStatus(e.target.value)} className="sr-only" />
                <XCircle size={20} className="mb-1" />
                <span className="text-xs font-semibold">Cancelled</span>
              </label>
            </div>
          </div>

          {!existingEvent && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isRecurring} 
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-700">Repeat weekly</span>
              </label>
              
              {isRecurring && (
                <div className="mt-3 pl-8 flex items-center gap-2">
                   <span className="text-sm text-slate-600">For the next</span>
                   <select 
                    value={recurringWeeks} 
                    onChange={(e) => setRecurringWeeks(Number(e.target.value))}
                    className="px-2 py-1 border border-slate-300 rounded bg-white text-sm"
                   >
                     <option value={4}>4 weeks</option>
                     <option value={8}>8 weeks</option>
                     <option value={12}>12 weeks</option>
                     <option value={52}>1 year</option>
                   </select>
                </div>
              )}
              {isRecurring && <p className="mt-3 text-xs text-slate-500">Existing assignments on future dates are kept.</p>}
            </div>
          )}

          <div className="pt-4 flex gap-3">
            {existingEvent && (
              <button type="button" onClick={handleDelete} disabled={saving} className="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors">
                Clear Day
              </button>
            )}
            <div className="flex-1"></div>
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !personId || roster.length === 0} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
