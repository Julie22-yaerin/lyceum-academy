import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface ChatMessage {
  id?: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  created_at?: string;
}

export async function loadHistory(userId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('pclick_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) { console.error('Supabase load:', error); return []; }
  return data || [];
}

export async function saveMessage(msg: ChatMessage): Promise<void> {
  const { error } = await supabase.from('pclick_messages').insert(msg);
  if (error) console.error('Supabase save:', error);
}
