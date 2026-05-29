import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ai } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { prompt } = await req.json();
  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  const systemPrompt = `You are a timetable scheduling assistant for a Kerala government school management system.

The user wants to add a scheduling constraint. Based on their description, generate a list of specific, actionable constraint items that should appear as checkboxes in the timetable constraints panel.

User's request: "${prompt}"

Context about this school system:
- Kerala government school with UP section (classes 5-7) and HS section (classes 8-10)
- 7 periods per day: slots 1-4 (morning/before lunch), slots 5-7 (afternoon/after lunch)
- 5 working days (Mon-Fri), sometimes Saturday
- Class teacher takes Period 1 each day
- Core subjects (English, Maths, etc.) in morning slots
- Evening priority subjects (PE, Art, IT Practical) in afternoon slots
- No teacher double-booking
- Each subject max once per day per division (unless consecutive slots required)

Return ONLY a valid JSON array of constraint objects. Each object must have:
- "label": string — a concise constraint description (1-2 sentences, clear and specific)
- "category": string — one of: "Teacher Rules", "Subject Distribution", "Slot Priority", "Class Teacher", "Consecutive Slots", "Language Variants", "Special Rules"
- "enabled": boolean — true if this should be enabled by default

Return ONLY the JSON array, no markdown, no explanation, no code fences. Example:
[{"label":"No teacher should teach more than 5 periods per day","category":"Teacher Rules","enabled":true}]`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: systemPrompt,
    });
    const text = (response.text || '').trim();

    // Try to extract JSON array
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const jsonText = jsonMatch ? jsonMatch[0] : text;

    const constraints = JSON.parse(jsonText);
    if (!Array.isArray(constraints)) throw new Error('Not an array');

    // Validate structure
    const validated = constraints
      .filter((c: any) => typeof c.label === 'string' && typeof c.category === 'string')
      .map((c: any) => ({
        id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        label: c.label,
        category: c.category,
        enabled: c.enabled !== false,
        source: 'ai' as const,
      }));

    return NextResponse.json({ success: true, data: validated });
  } catch (error) {
    console.error('AI constraint generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate constraints. Please try rephrasing your request.' },
      { status: 500 }
    );
  }
}
