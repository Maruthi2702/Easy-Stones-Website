// Simple test script to check what's happening with visit data
const visitMock = {
  _id: "123",
  date: "2026-01-18",
  purpose: "Test",
  notes: "Test notes",
  outcome: "Good",
  followUp: "Follow up",
  image: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="]
};

const apiResponse = { visit: visitMock };

console.log("API Response:", apiResponse);
console.log("visit.image:", apiResponse.visit.image);
console.log("Is array:", Array.isArray(apiResponse.visit.image));
console.log("Length:", apiResponse.visit.image.length);

// Simulate what frontend does
const data = apiResponse;
let visitForm;

if (data && data.visit) {
    visitForm = data.visit;
    console.log("\n✓ Using data.visit");
} else {
    visitForm = visitMock;  // fallback
    console.log("\n✗ Using fallback");
}

console.log("visitForm.image:", visitForm.image);
console.log("Should show attachments:", visitForm.image && Array.isArray(visitForm.image) && visitForm.image.length > 0);
