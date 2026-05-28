import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function generateCertificateContent(
  type: string,
  teacherName: string,
  schoolName: string,
  additionalContext: string,
  supportingDocContent?: string
): Promise<string> {
  const prompts: Record<string, string> = {
    COVER_LETTER: `Generate a professional cover letter for a government school teacher.
Teacher Name: ${teacherName}
School: ${schoolName}
Context: ${additionalContext}
${supportingDocContent ? `Supporting Document Content: ${supportingDocContent}` : ''}

Write a formal cover letter suitable for Kerala government school administration. Use proper formatting with date, recipient details, subject line, body, and signature block. Keep it professional and concise.`,

    RELIEVING_ORDER: `Generate a formal relieving order for a government school teacher.
Teacher Name: ${teacherName}
School: ${schoolName}
Context: ${additionalContext}
${supportingDocContent ? `Supporting Document Content: ${supportingDocContent}` : ''}

Write a formal relieving order suitable for Kerala government school administration. Include order number placeholder, date, proper formatting with official language.`,

    DUTY_CERTIFICATE: `Generate a duty certificate for a government school teacher.
Teacher Name: ${teacherName}
School: ${schoolName}
Context: ${additionalContext}
${supportingDocContent ? `Supporting Document Content: ${supportingDocContent}` : ''}

Write a formal duty certificate suitable for Kerala government school administration. Include certificate number placeholder, date, proper formatting with official language and seal placeholder.`,
  };

  const prompt = prompts[type] || prompts.COVER_LETTER;

  try {
    const result = await geminiModel.generateContent(prompt);
    const response = result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Error('Failed to generate certificate content');
  }
}

export async function generateTimetableWithAI(
  constraints: any
): Promise<any> {
  const prompt = `You are a timetable scheduling assistant for a Kerala government school. Given the following constraints, generate an optimal weekly timetable.

Constraints:
${JSON.stringify(constraints, null, 2)}

Rules:
1. 7 periods per day (4 before lunch: slots 1-4, 3 after lunch: slots 5-7)
2. Days: Monday to Friday (5 days)
3. Class teacher must take Period 1 of their class
4. Core subjects should be in morning slots (1-4)
5. Evening priority subjects should be in afternoon slots (5-7)
6. No teacher can be double-booked
7. Each subject should appear at most once per day per division
8. Consecutive slots for subjects that require them
9. Uniform distribution of teaching load
10. Single teacher assigned per subject per division

Return the timetable as a JSON array with objects having: divisionId, dayOfWeek (1-5), slotNumber (1-7), subjectId, teacherId.
Return ONLY valid JSON, no markdown formatting.`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    // Try to extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini timetable generation error:', error);
    throw new Error('Failed to generate timetable with AI');
  }
}
