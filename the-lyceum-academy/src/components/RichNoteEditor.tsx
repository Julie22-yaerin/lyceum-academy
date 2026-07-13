import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';

interface RichNoteEditorProps {
  content: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  className?: string;
}

function Toolbar({ editor }: { editor: any }) {
  const btn = (label: string, action: () => void, active?: boolean) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); action(); }}
      className={`px-2 py-1 text-xs leading-none border border-white/10 transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-white/10 bg-white/5 backdrop-blur-xl">
      {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {btn('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
      <span className="w-px h-4 bg-white/10 mx-1" />
      {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
      {btn('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
      <span className="w-px h-4 bg-white/10 mx-1" />
      {btn('• List', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn('1. List', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn('"', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
    </div>
  );
}

export default function RichNoteEditor({ content, placeholder = '', onChange, className = '' }: RichNoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Placeholder.configure({ placeholder }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none px-3 py-3 min-h-[120px]',
      },
    },
  });

  return (
    <div className={`glass-strong rounded-lg overflow-hidden ${className}`}>
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
