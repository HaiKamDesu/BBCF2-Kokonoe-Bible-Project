// Simple prototype functionality
document.addEventListener('DOMContentLoaded', function () {
    // Confirm the page loaded
    console.log('Kokonoe Combo Bible - Prototype Loaded');

    // Add some basic interactivity to nodes
    const nodes = document.querySelectorAll('.node');

    nodes.forEach(node => {
        node.addEventListener('click', function () {
            // Simple click feedback
            this.style.boxShadow = '0 0 20px rgba(74, 158, 255, 0.6)';

            setTimeout(() => {
                this.style.boxShadow = 'none';
            }, 300);
        });
    });

    // Update timestamp to show it's live
    const timestamp = new Date().toLocaleString();
    console.log(`Site updated: ${timestamp}`);
});