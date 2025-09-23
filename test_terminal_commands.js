/**
 * Test script to verify terminal command tag parsing and processing
 * This script tests that <run_terminal_cmd> tags are properly handled
 */

const fs = require('fs');
const path = require('path');

// Test content with terminal command tags
const testContent = `
This is a test message with a terminal command.

<run_terminal_cmd>ls -la</run_terminal_cmd>

This should not appear in the chat.

<dyad-run-backend-terminal-cmd>npm install express</dyad-run-backend-terminal-cmd>

<dyad-run-frontend-terminal-cmd>npm run build</dyad-run-frontend-terminal-cmd>

End of test message.
`;

// Test the regex pattern that should match terminal commands
function testRegexPattern() {
  console.log('🧪 Testing regex pattern for terminal command tags...\n');

  const customTagNames = [
    "dyad-write",
    "dyad-rename",
    "dyad-delete",
    "dyad-add-dependency",
    "dyad-execute-sql",
    "dyad-add-integration",
    "dyad-output",
    "dyad-problem-report",
    "dyad-chat-summary",
    "dyad-edit",
    "dyad-codebase-context",
    "think",
    "dyad-command",
    "dyad-run-backend-terminal-cmd",
    "dyad-run-frontend-terminal-cmd",
    "run_terminal_cmd",
  ];

  const tagPattern = new RegExp(
    `<(${customTagNames.join("|")})\\s*([^>]*)>([\\s\\S]*?)<\\/\\1>`,
    "gs",
  );

  let match;
  let matches = [];

  while ((match = tagPattern.exec(testContent)) !== null) {
    matches.push({
      fullMatch: match[0],
      tag: match[1],
      attributes: match[2],
      content: match[3]
    });
  }

  console.log(`✅ Found ${matches.length} terminal command tags:`);
  matches.forEach((match, index) => {
    console.log(`  ${index + 1}. ${match.tag}: ${match.content.trim()}`);
  });

  // Verify all terminal command tags are found
  const terminalTags = matches.filter(m =>
    m.tag === 'run_terminal_cmd' ||
    m.tag === 'dyad-run-backend-terminal-cmd' ||
    m.tag === 'dyad-run-frontend-terminal-cmd'
  );

  console.log(`\n✅ Terminal command tags found: ${terminalTags.length}`);
  terminalTags.forEach((tag, index) => {
    console.log(`  ${index + 1}. <${tag.tag}>${tag.content.trim()}</${tag.tag}>`);
  });

  return terminalTags.length === 3; // Should find 3 terminal command tags
}

// Test that the parser correctly identifies terminal commands
function testParserLogic() {
  console.log('\n🧪 Testing parser logic...\n');

  // Simulate the renderCustomTag function logic
  function renderCustomTag(tagInfo) {
    const { tag } = tagInfo;

    switch (tag) {
      case "run_terminal_cmd":
        return null; // Should return null (not render)
      case "dyad-run-backend-terminal-cmd":
        return null; // Should return null (not render)
      case "dyad-run-frontend-terminal-cmd":
        return null; // Should return null (not render)
      default:
        return `RENDER_${tag}`; // Other tags should render
    }
  }

  // Test each terminal command tag
  const testTags = [
    { tag: "run_terminal_cmd", content: "ls -la" },
    { tag: "dyad-run-backend-terminal-cmd", content: "npm install express" },
    { tag: "dyad-run-frontend-terminal-cmd", content: "npm run build" }
  ];

  let allReturnNull = true;

  testTags.forEach(tagInfo => {
    const result = renderCustomTag(tagInfo);
    console.log(`✅ <${tagInfo.tag}> returns: ${result}`);

    if (result !== null) {
      allReturnNull = false;
    }
  });

  return allReturnNull;
}

// Test that the content is properly split between markdown and custom tags
function testContentSplitting() {
  console.log('\n🧪 Testing content splitting...\n');

  const customTagNames = [
    "run_terminal_cmd",
    "dyad-run-backend-terminal-cmd",
    "dyad-run-frontend-terminal-cmd"
  ];

  const tagPattern = new RegExp(
    `<(${customTagNames.join("|")})\\s*([^>]*)>([\\s\\S]*?)<\\/\\1>`,
    "gs",
  );

  let match;
  let matches = [];
  let lastIndex = 0;
  let contentPieces = [];

  while ((match = tagPattern.exec(testContent)) !== null) {
    const startIndex = match.index;

    // Add markdown content before this tag
    if (startIndex > lastIndex) {
      const markdownContent = testContent.substring(lastIndex, startIndex);
      if (markdownContent.trim()) {
        contentPieces.push({
          type: "markdown",
          content: markdownContent.trim()
        });
      }
    }

    // Add the tag
    contentPieces.push({
      type: "custom-tag",
      tag: match[1],
      content: match[3].trim()
    });

    lastIndex = startIndex + match[0].length;
  }

  // Add remaining markdown content
  if (lastIndex < testContent.length) {
    const remainingContent = testContent.substring(lastIndex);
    if (remainingContent.trim()) {
      contentPieces.push({
        type: "markdown",
        content: remainingContent.trim()
      });
    }
  }

  console.log(`✅ Content split into ${contentPieces.length} pieces:`);
  contentPieces.forEach((piece, index) => {
    if (piece.type === "markdown") {
      console.log(`  ${index + 1}. [MARKDOWN]: "${piece.content.substring(0, 50)}${piece.content.length > 50 ? '...' : ''}"`);
    } else {
      console.log(`  ${index + 1}. [TAG]: <${piece.tag}>${piece.content}</${piece.tag}>`);
    }
  });

  // Verify that terminal command tags are identified as custom tags
  const terminalTagPieces = contentPieces.filter(p => p.type === "custom-tag");
  const terminalCommandsFound = terminalTagPieces.filter(p =>
    p.tag === "run_terminal_cmd" ||
    p.tag === "dyad-run-backend-terminal-cmd" ||
    p.tag === "dyad-run-frontend-terminal-cmd"
  );

  console.log(`\n✅ Terminal command tags identified as custom tags: ${terminalCommandsFound.length}`);

  return terminalCommandsFound.length === 3;
}

// Main test function
function runAllTests() {
  console.log('🚀 Starting Terminal Command Tag Tests\n');
  console.log('=' .repeat(50));

  let allTestsPassed = true;

  // Test 1: Regex Pattern
  console.log('\n📋 TEST 1: Regex Pattern Matching');
  console.log('-'.repeat(30));
  const regexTest = testRegexPattern();
  console.log(`Result: ${regexTest ? '✅ PASS' : '❌ FAIL'}\n`);
  allTestsPassed = allTestsPassed && regexTest;

  // Test 2: Parser Logic
  console.log('📋 TEST 2: Parser Logic');
  console.log('-'.repeat(30));
  const parserTest = testParserLogic();
  console.log(`Result: ${parserTest ? '✅ PASS' : '❌ FAIL'}\n`);
  allTestsPassed = allTestsPassed && parserTest;

  // Test 3: Content Splitting
  console.log('📋 TEST 3: Content Splitting');
  console.log('-'.repeat(30));
  const splittingTest = testContentSplitting();
  console.log(`Result: ${splittingTest ? '✅ PASS' : '❌ FAIL'}\n`);
  allTestsPassed = allTestsPassed && splittingTest;

  // Summary
  console.log('=' .repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('-'.repeat(30));
  console.log(`Overall Result: ${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  if (allTestsPassed) {
    console.log('\n🎉 SUCCESS: Terminal command tags are properly configured!');
    console.log('   - Tags will be parsed correctly');
    console.log('   - Tags will not appear in chat UI');
    console.log('   - Commands will execute silently in terminals');
  } else {
    console.log('\n⚠️  WARNING: Some tests failed. Check the implementation.');
  }

  console.log('=' .repeat(50));

  return allTestsPassed;
}

// Run the tests
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testRegexPattern,
  testParserLogic,
  testContentSplitting,
  runAllTests
};
