/**
 * @file Help.jsx
 * @description FAQ and Help Page component.
 * Renders an accordion list of frequently asked questions regarding room setups,
 * data persistence, privacy policies, and live sharing features.
 */

import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import './About.css';

/**
 * Help Component
 * Handles the accordion toggle layout using local state index references.
 */
export default function Help() {
  // tracks the currently expanded index (null if all are collapsed)
  const [activeIndex, setActiveIndex] = useState(null);

  /**
   * Toggles the target FAQ slide. If clicked again, collapses the active index.
   * @param {number} index - Index of the target FAQ item
   */
  const toggleAccordion = (index) => {
    setActiveIndex(prev => (prev === index ? null : index));
  };

  // FAQ structure array
  const faqs = [
    {
      question: 'How do I start a new chat?',
      answer: 'On the home page, enter a unique name for your chat room, provide an access key, and click "Join Chat Room". Share the URL (e.g. /chat/room-name) and the key with others to invite them into the conversation.'
    },
    {
      question: 'How do I create a project?',
      answer: 'On the home page, use the "Start or Open a Project" section to enter a project name and an access key, then click "Create & Go". A shared workspace with a sketch board, rich text document, and VS Code-style editor will be generated instantly.'
    },
    {
      question: 'Is my data private?',
      answer: 'Yes. We do not collect or request personal information. Each collaborator is assigned a temporary, anonymous name. Project and chat data are stored for persistence so you can resume work, but are never linked to your real identity.'
    },
    {
      question: 'Can I share a project link?',
      answer: 'Absolutely. Share the project URL and the access key with anyone you\'d like to collaborate with. They can join instantly and see real-time updates as you draw, write, and edit code together.'
    }
  ];

  return (
    <main className="page-container">
      {/* Title Header with Icon */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '40px' }}>
        <HelpCircle size={36} color="var(--primary-color)" />
        <h2 className="title-center" style={{ margin: 0 }}>Help & FAQs</h2>
      </div>

      {/* FAQ Accordion List */}
      <div className="faq-accordion">
        {faqs.map((faq, index) => {
          const isActive = activeIndex === index;
          return (
            <div key={index} className={`faq-item ${isActive ? 'active' : ''}`}>
              {/* Toggleable Accordion Header */}
              <div className="faq-header" onClick={() => toggleAccordion(index)}>
                <span>{faq.question}</span>
                <ChevronDown className="faq-icon" size={18} />
              </div>
              
              {/* Collapsible Accordion Content */}
              <div className="faq-content">
                <p>{faq.answer}</p>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

